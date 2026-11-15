import { AjvCompiler } from '@fastify/ajv-compiler';

const compilerPool = AjvCompiler();
type ValidatorFactory = ReturnType<typeof AjvCompiler>;

// Preserve Fastify's encapsulated/shared-schema handling while treating JSON bodies
// strictly. URL query/params arrive as strings, so their declared numeric types need
// wire conversion (e.g. ?limit=100). Neither compiler removes additional properties.
export const buildHttpValidator: ValidatorFactory = (externalSchemas, options) => {
  const sharedOptions = {
    plugins: options?.plugins ?? [],
    ...(options?.onCreate ? { onCreate: options.onCreate } : {}),
  };
  const body = compilerPool(externalSchemas, { ...sharedOptions,
    customOptions: { ...options?.customOptions, removeAdditional: false, coerceTypes: false, allErrors: false },
  });
  const wire = compilerPool(externalSchemas, { ...sharedOptions,
    customOptions: { ...options?.customOptions, removeAdditional: false, coerceTypes: true, allErrors: false },
  });
  return (definition) => {
    const part = typeof definition === 'object' && 'httpPart' in definition ? definition.httpPart : undefined;
    return (part === 'body' ? body : wire)(definition);
  };
};
