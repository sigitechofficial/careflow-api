import { Injectable, Logger, SetMetadata } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { JOB_NAMES, type JobName } from './job-catalogue';
import type { JobWork } from './job-run.types';

export const JOB_HANDLER_KEY = 'careflow:job-handler';

/**
 * Marks the method that performs one run of a catalogue job (returns a JobOutcome).
 * Used by the internal trigger endpoint, the CLI and admin "Run now"; the class's @Cron
 * handler calls the same method through JobRunner.
 */
export const JobHandler = (name: JobName) => SetMetadata(JOB_HANDLER_KEY, name);

@Injectable()
export class JobHandlerRegistry {
  private readonly logger = new Logger(JobHandlerRegistry.name);
  private handlers: Map<JobName, JobWork> | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  get(name: JobName): JobWork | undefined {
    return this.resolve().get(name);
  }

  registeredNames(): JobName[] {
    return [...this.resolve().keys()];
  }

  private resolve(): Map<JobName, JobWork> {
    if (this.handlers) return this.handlers;
    const found = new Map<JobName, JobWork>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (
        !instance ||
        typeof instance !== 'object' ||
        !wrapper.isDependencyTreeStatic()
      )
        continue;
      const proto = Object.getPrototypeOf(instance) as object | null;
      if (!proto) continue;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = instance[methodName];
        if (typeof method !== 'function') continue;
        const name = this.reflector.get<JobName | undefined>(
          JOB_HANDLER_KEY,
          method,
        );
        if (!name) continue;
        if (found.has(name)) {
          this.logger.warn(
            `Duplicate job handler for ${name} (${wrapper.name}.${methodName}) ignored`,
          );
          continue;
        }
        found.set(name, () =>
          (method as () => ReturnType<JobWork>).call(instance),
        );
      }
    }
    const missing = JOB_NAMES.filter((n) => !found.has(n));
    if (missing.length) {
      this.logger.warn(`No job handler registered for: ${missing.join(', ')}`);
    }
    this.handlers = found;
    return found;
  }
}
