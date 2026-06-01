export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) {
      continue;
    }

    const withoutPrefix = raw.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

export function hasFlag(args, name) {
  return args[name] === true || args[name] === "true" || args[name] === "1";
}

export function hasNegativeFlag(args, name) {
  return hasFlag(args, `no-${name}`) || args[name] === "false" || args[name] === "0";
}
