import { existsSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !context.parentURL ||
      !(specifier.startsWith('./') || specifier.startsWith('../')) ||
      /\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      throw error;
    }

    const url = new URL(`${specifier}.ts`, context.parentURL);

    if (!existsSync(url)) {
      throw error;
    }

    return {
      shortCircuit: true,
      url: url.href,
    };
  }
}
