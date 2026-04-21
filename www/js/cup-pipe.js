// cup-pipe.js — Browser-native pipeline runtime.
// Payload → Filter → Pipeline → State → Hook → Tap → Valve.
// Zero dependencies.

// ── Payload ───────────────────────────────────────────────────────
// Immutable data container flowing through pipelines.
export class Payload {
  #data;
  #traceId;
  #lineage;

  constructor(data = {}, options = {}) {
    this.#data = Object.freeze({ ...data });
    this.#traceId = options.traceId ?? undefined;
    this.#lineage = Object.freeze(options.lineage ? [...options.lineage] : []);
  }

  get(key, defaultValue = undefined) {
    const val = this.#data[key];
    return val !== undefined ? val : defaultValue;
  }

  get traceId() { return this.#traceId; }
  get lineage() { return [...this.#lineage]; }

  insert(key, value) {
    return new Payload(
      { ...this.#data, [key]: value },
      { traceId: this.#traceId, lineage: [...this.#lineage] },
    );
  }

  insertAs(key, value) { return this.insert(key, value); }

  withTrace(traceId) {
    return new Payload({ ...this.#data }, { traceId, lineage: [...this.#lineage] });
  }

  _stamp(stepName) {
    return new Payload(
      { ...this.#data },
      { traceId: this.#traceId, lineage: [...this.#lineage, stepName] },
    );
  }

  merge(other) {
    return new Payload(
      { ...this.#data, ...other.toDict() },
      { traceId: this.#traceId ?? other.traceId, lineage: [...this.#lineage, ...other.lineage] },
    );
  }

  withMutation() { return new MutablePayload({ ...this.#data }, { traceId: this.#traceId, lineage: [...this.#lineage] }); }
  toDict() { return { ...this.#data }; }
  toString() { return this.#traceId ? `Payload(${JSON.stringify(this.#data)}, traceId='${this.#traceId}')` : `Payload(${JSON.stringify(this.#data)})`; }
}

// ── MutablePayload ────────────────────────────────────────────────
export class MutablePayload {
  #data;
  #traceId;
  #lineage;

  constructor(data = {}, options = {}) {
    this.#data = { ...data };
    this.#traceId = options.traceId ?? undefined;
    this.#lineage = options.lineage ? [...options.lineage] : [];
  }

  get(key, defaultValue = undefined) {
    const val = this.#data[key];
    return val !== undefined ? val : defaultValue;
  }

  set(key, value) { this.#data[key] = value; }
  get traceId() { return this.#traceId; }
  get lineage() { return [...this.#lineage]; }
  toImmutable() { return new Payload({ ...this.#data }, { traceId: this.#traceId, lineage: [...this.#lineage] }); }
}

// ── State ─────────────────────────────────────────────────────────
// Pipeline execution metadata.
export class State {
  constructor() {
    this.executed = [];
    this.skipped = [];
    this.errors = [];
    this.timings = {};
    this.metadata = {};
  }

  markExecuted(name) { this.executed.push(name); }
  markSkipped(name) { this.skipped.push(name); }
  recordTiming(name, duration) { this.timings[name] = duration; }
  recordError(name, error) { this.errors.push([name, error]); }
  set(key, value) { this.metadata[key] = value; }
  get(key, defaultValue = undefined) { return this.metadata[key] ?? defaultValue; }
  get hasErrors() { return this.errors.length > 0; }
  get lastError() { return this.errors.length > 0 ? this.errors[this.errors.length - 1] : null; }
}

// ── Valve ─────────────────────────────────────────────────────────
// Conditional flow control — gates a Filter with a predicate.
export class Valve {
  constructor(name, innerFilter, predicate) {
    this.name = name;
    this._inner = innerFilter;
    this._predicate = predicate;
    this._lastSkipped = false;
  }

  async call(payload) {
    if (this._predicate(payload)) {
      this._lastSkipped = false;
      return await this._inner.call(payload);
    }
    this._lastSkipped = true;
    return payload;
  }
}

// ── Pipeline ──────────────────────────────────────────────────────
// Orchestrator — runs filters in sequence with hooks, taps, and state.
export class Pipeline {
  #steps = [];
  #hooks = [];
  #state = new State();
  #observeTiming = false;
  #observeLineage = false;

  get state() { return this.#state; }

  addFilter(filter, name) {
    const filterName = name ?? filter.constructor?.name ?? 'anonymous';
    this.#steps.push({ name: filterName, step: filter, type: 'filter' });
    return this;
  }

  addTap(tap, name) {
    const tapName = name ?? tap.constructor?.name ?? 'anonymous';
    this.#steps.push({ name: tapName, step: tap, type: 'tap' });
    return this;
  }

  useHook(hook) {
    this.#hooks.push(hook);
    return this;
  }

  addPipeline(pipeline, name) {
    this.#steps.push({ name, step: pipeline, type: 'pipeline' });
    return this;
  }

  observe(options = {}) {
    this.#observeTiming = options.timing ?? true;
    this.#observeLineage = options.lineage ?? false;
    return this;
  }

  async call(payload) { return this.run(payload); }

  async run(initialPayload) {
    this.#state = new State();
    let payload = initialPayload;

    // Hook: pipeline start
    for (const hook of this.#hooks) {
      if (hook.before) await hook.before(null, payload);
    }

    let stepName;
    let stepT0;

    try {
      for (const { name, step, type } of this.#steps) {
        stepName = name;

        // — Tap —
        if (type === 'tap') {
          await step.observe(payload);
          this.#state.markExecuted(name);
          continue;
        }

        stepT0 = performance.now();

        // — Nested Pipeline —
        if (type === 'pipeline' && step instanceof Pipeline) {
          for (const hook of this.#hooks) { if (hook.before) await hook.before(step, payload); }
          payload = await step.run(payload);
          this.#state.markExecuted(name);
          for (const hook of this.#hooks) { if (hook.after) await hook.after(step, payload); }
        }
        // — Filter / Valve —
        else {
          for (const hook of this.#hooks) { if (hook.before) await hook.before(step, payload); }

          payload = await step.call(payload);

          // Valve skip detection
          if ('_lastSkipped' in step && step._lastSkipped) {
            this.#state.markSkipped(name);
          } else {
            this.#state.markExecuted(name);
          }

          for (const hook of this.#hooks) { if (hook.after) await hook.after(step, payload); }
        }

        // Post-step instrumentation
        const duration = (performance.now() - stepT0) / 1000;
        if (this.#observeTiming) this.#state.recordTiming(name, duration);
        if (this.#observeLineage) payload = payload._stamp(name);
      }
    } catch (e) {
      if (stepT0 !== undefined && stepName !== undefined) {
        const duration = (performance.now() - stepT0) / 1000;
        if (this.#observeTiming) this.#state.recordTiming(stepName, duration);
      }
      const error = e instanceof Error ? e : new Error(String(e));
      this.#state.recordError(stepName, error);
      for (const hook of this.#hooks) {
        if (hook.onError) await hook.onError(null, error, payload);
      }
      throw e;
    }

    // Hook: pipeline end
    for (const hook of this.#hooks) {
      if (hook.after) await hook.after(null, payload);
    }

    return payload;
  }

  describe() {
    return {
      steps: this.#steps.map(({ name, type }) => ({ name, type })),
      hooks: this.#hooks.map(h => h.constructor?.name ?? 'anonymous'),
      step_count: this.#steps.length,
    };
  }
}
