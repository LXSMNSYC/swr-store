import {
  getMutation,
  getMutationListenerSize,
  MutationListener,
  MutationPending,
  MutationResult,
  setMutation,
} from './cache/mutation-cache';
import {
  addRevalidationListener,
  removeRevalidationListener,
  setRevalidation,
} from './cache/revalidation-cache';
import {
  mutate,
  subscribe,
  trigger,
} from './global';
import IS_CLIENT from './is-client';
import NoServerFetchError from './no-server-fetch-error';

export type SWRTrigger<P extends any[] = []> =
  (args: P, shouldRevalidate?: boolean) => void;

export type SWRMutate<T, P extends any[] = []> =
  (args: P, data: MutationResult<T>, shouldRevalidate?: boolean) => void;

export interface SWRGetOptions<T> {
  shouldRevalidate?: boolean;
  initialData?: T;
}

export type SWRGet<T, P extends any[] = []> =
  (args: P, options?: SWRGetOptions<T>) => MutationResult<T>;

export type SWRSubscribe<T, P extends any[] = []> =
  (args: P, listener: MutationListener<T>) => () => void;

export interface SWRStoreBaseOptions<T, P extends any[] = []> {
  get: (...args: P) => Promise<T>;
  initialData?: T;
  refreshInterval?: number;
}

export interface SWRStoreExtendedOptions<P extends any[] = []> {
  key: (...args: P) => string;

  revalidateOnFocus: boolean;
  revalidateOnVisibility: boolean;
  revalidateOnNetwork: boolean;

  refreshWhenOffline: boolean;
  refreshWhenHidden: boolean;
  refreshWhenBlurred: boolean;

  freshAge: number;
  staleAge: number;
}

export type SWRStorePartialOptions<P extends any[] = []> =
  Partial<SWRStoreExtendedOptions<P>>;

export interface SWRStoreOptions<T, P extends any[] = []>
  extends SWRStorePartialOptions<P>, SWRStoreBaseOptions<T, P> {
}

export interface SWRFullOptions<T, P extends any[] = []>
  extends SWRStoreExtendedOptions<P>, SWRStoreBaseOptions<T, P> {
}

export interface SWRStore<T, P extends any[] = []> {
  trigger: SWRTrigger<P>;
  mutate: SWRMutate<T, P>;
  get: SWRGet<T, P>;
  subscribe: SWRSubscribe<T, P>;
}

function defaultKey<P extends any[] = []>(...args: P): string {
  return JSON.stringify(args);
}

export default function createSWRStore<T, P extends any[] = []>(
  options: SWRStoreOptions<T, P>,
): SWRStore<T, P> {
  const defaultOpts: SWRStoreExtendedOptions<P> = {
    revalidateOnFocus: false,
    revalidateOnNetwork: false,
    revalidateOnVisibility: false,
    refreshWhenHidden: false,
    refreshWhenBlurred: false,
    refreshWhenOffline: false,
    freshAge: 2000,
    staleAge: 30000,
    key: defaultKey,
  };
  const fullOpts: SWRFullOptions<T, P> = {
    ...defaultOpts,
    ...options,
  };

  // This function revalidates the mutation cache
  // through reactive process
  const revalidate: SWRGet<T, P> = (args, options) => {
    const defaultRevalidateOptions: SWRGetOptions<T> = {
      shouldRevalidate: true,
      initialData: fullOpts.initialData,
    };
    const revalidateOptions: SWRGetOptions<T> = {
      ...defaultRevalidateOptions,
      ...options,
    };
    // Parse key
    const generatedKey = fullOpts.key(...args);

    // Capture timestamp
    const timestamp = Date.now();

    // Get current mutation
    let currentMutation = getMutation<T>(generatedKey);

    // Hydrate mutation
    if (!currentMutation && revalidateOptions.initialData) {
      currentMutation = {
        result: {
          data: revalidateOptions.initialData,
          status: 'success',
        },
        timestamp,
      };
      setMutation(generatedKey, currentMutation);
    }

    // Opt-out of fetching process
    // if running on server
    if (!IS_CLIENT) {
      // If there is no mutation, throw an error
      if (!currentMutation) {
        throw new NoServerFetchError();
      }
      return {
        ...currentMutation.result,
      };
    }

    if (currentMutation) {
      if (!revalidateOptions.shouldRevalidate) {
        return {
          ...currentMutation.result,
        };
      }
      // If mutation is still fresh, return mutation
      if (currentMutation.timestamp + fullOpts.freshAge > timestamp) {
        return {
          ...currentMutation.result,
        };
      }
    }

    // Perform fetch
    const pendingData = fullOpts.get(...args);

    // Capture result
    const result: MutationPending<T> = {
      data: pendingData,
      status: 'pending',
    };

    // Watch for promise resolutions
    // to update cache data
    pendingData.then(
      (data) => {
        const current = getMutation(generatedKey)?.timestamp;
        if (current && current <= timestamp) {
          setMutation(generatedKey, {
            result: {
              data,
              status: 'success',
            },
            timestamp: current,
          });
        }
      },
      (data) => {
        const current = getMutation(generatedKey)?.timestamp;
        if (current && current <= timestamp) {
          setMutation(generatedKey, {
            result: {
              data,
              status: 'failure',
            },
            timestamp: current,
          });
        }
      },
    );

    // If there's an existing mutation
    // and mutation is stale
    // update timestamp and return
    if (
      currentMutation
      && currentMutation.timestamp + fullOpts.freshAge + fullOpts.staleAge > timestamp
    ) {
      // Updating this means that the freshness or the staleness
      // of a mutation resets
      currentMutation.timestamp = timestamp;
      return {
        ...currentMutation.result,
      };
    }

    // Otherwise, set the new mutation
    setMutation(generatedKey, {
      result,
      timestamp,
    });

    return {
      ...result,
    };
  };

  type Cleanup = () => void;
  type Cleanups = Cleanup[];
  type Subscribe = () => Cleanup;

  const cleanups = new Map<string, Cleanups>();

  // This lazy registration allows manageable
  // global source subscriptions by performing
  // reference-counting.
  const lazyRegister = (...args: P) => {
    // Get generated key
    const generatedKey = fullOpts.key(...args);

    // If there are listeners, it means
    // that the store has already made subscriptions
    if (getMutationListenerSize(generatedKey) > 0) {
      return;
    }

    // Create cleanup stack
    const currentCleanups: Cleanups = [];

    const subscription = (sub: Subscribe) => {
      currentCleanups.push(sub());
    };

    const onRevalidate = () => {
      setRevalidation(generatedKey, true);
    };
    subscription(() => {
      const innerRevalidate = (flag: boolean) => {
        revalidate(args, {
          shouldRevalidate: flag,
        });
      };
      addRevalidationListener(generatedKey, innerRevalidate);
      return () => {
        removeRevalidationListener(generatedKey, innerRevalidate);
      };
    });

    // Only register on client-side
    if (IS_CLIENT) {
      // Register polling interval
      if (fullOpts.refreshInterval != null) {
        if (fullOpts.refreshWhenBlurred) {
          subscription(() => {
            let interval: undefined | number;

            const enter = () => {
              clearInterval(interval);
              interval = setInterval(onRevalidate, fullOpts.refreshInterval);
            };
            const exit = () => {
              clearInterval(interval);
              interval = undefined;
            };

            window.addEventListener('blur', enter, false);
            window.addEventListener('focus', exit, false);

            return () => {
              window.removeEventListener('blur', enter, false);
              window.removeEventListener('focus', exit, false);
              clearInterval(interval);
            };
          });
        }
        if (fullOpts.refreshWhenOffline) {
          subscription(() => {
            let interval: undefined | number;

            const enter = () => {
              clearInterval(interval);
              interval = setInterval(onRevalidate, fullOpts.refreshInterval);
            };
            const exit = () => {
              clearInterval(interval);
              interval = undefined;
            };

            window.addEventListener('offline', enter, false);
            window.addEventListener('online', exit, false);

            return () => {
              window.removeEventListener('offline', enter, false);
              window.removeEventListener('online', exit, false);
              clearInterval(interval);
            };
          });
        }
        if (fullOpts.refreshWhenHidden) {
          subscription(() => {
            let interval: undefined | number;

            const onVisibility = () => {
              clearInterval(interval);
              if (document.visibilityState === 'visible') {
                interval = undefined;
              } else {
                interval = setInterval(onRevalidate, fullOpts.refreshInterval);
              }
            };

            document.addEventListener('visibilitychange', onVisibility, false);

            return () => {
              document.removeEventListener('visibilitychange', onVisibility, false);
              clearInterval(interval);
            };
          });
        }
        if (
          !(fullOpts.refreshWhenHidden
          || fullOpts.refreshWhenBlurred
          || fullOpts.refreshWhenOffline)
        ) {
          subscription(() => {
            const interval = setInterval(onRevalidate, fullOpts.refreshInterval);

            return () => {
              clearInterval(interval);
            };
          });
        }
      }

      // Registers a focus event for revalidation.
      if (options.revalidateOnFocus) {
        subscription(() => {
          window.addEventListener('focus', onRevalidate, false);

          return () => {
            window.removeEventListener('focus', onRevalidate, false);
          };
        });
      }

      // Registers a online event for revalidation.
      if (options.revalidateOnNetwork) {
        subscription(() => {
          window.addEventListener('online', onRevalidate, false);

          return () => {
            window.removeEventListener('online', onRevalidate, false);
          };
        });
      }

      // Registers a visibility change event for revalidation.
      if (options.revalidateOnVisibility) {
        subscription(() => {
          const onVisible = () => {
            if (document.visibilityState === 'visible') {
              onRevalidate();
            }
          };

          window.addEventListener('visibilitychange', onVisible, false);

          return () => {
            window.removeEventListener('visibilitychange', onVisible, false);
          };
        });
      }
    }

    cleanups.set(generatedKey, currentCleanups);
  };

  const lazyUnregister = (generatedKey: string) => {
    if (getMutationListenerSize(generatedKey) === 0) {
      cleanups.get(generatedKey)?.forEach((cleanup) => {
        cleanup();
      });
      cleanups.delete(generatedKey);
    }
  };

  return {
    trigger: (args, shouldRevalidate = true) => {
      const generatedKey = fullOpts.key(...args);
      trigger(generatedKey, shouldRevalidate);
    },
    mutate: (args, data, shouldRevalidate = true) => {
      const generatedKey = fullOpts.key(...args);
      mutate(generatedKey, data, shouldRevalidate);
    },
    get: revalidate,
    subscribe: (args, listener) => {
      const generatedKey = fullOpts.key(...args);

      // Setup lazy global registration
      lazyRegister(...args);

      const unsubscribe = subscribe(generatedKey, listener);
      return () => {
        unsubscribe();

        // Attempt lazy unregistration
        lazyUnregister(generatedKey);
      };
    },
  };
}
