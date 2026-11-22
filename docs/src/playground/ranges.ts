import ts from "typescript";

export type Ranges = Record<string, [from: number, to: number]>;

export function specRanges(source: string): Ranges {
  const file = ts.createSourceFile("spec.ts", source, ts.ScriptTarget.Latest, true);
  const ranges: Ranges = {};
  const line = (pos: number) => file.getLineAndCharacterOfPosition(pos).line + 1;
  const put = (path: string, node: ts.Node) =>
    (ranges[path] = [line(node.getStart(file)), line(node.getEnd())]);

  function walk(node: ts.Expression, path: string) {
    put(path, node);
    if (!ts.isObjectLiteralExpression(node)) {
      return;
    }
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
        continue;
      }
      const key = property.name.text;
      if (!["args", "options", "subcommands"].includes(key)) {
        continue;
      }
      const value = property.initializer;
      const items = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
      items.forEach((item, i) => walk(item, `${path}.${key}.${i}`));
    }
  }

  ts.forEachChild(file, function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "spec" &&
      node.arguments[0]
    ) {
      walk(node.arguments[0], "spec");
      return;
    }
    ts.forEachChild(node, visit);
  });
  return ranges;
}
