import path from "node:path";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseAstAsync,
  type HmrContext,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from "vite";
import { findSpecialPage, scanPages } from "./routing/scan.ts";
import {
  validateRuleSource,
  type HeaderRule,
  type RedirectRule,
  type RewriteRule,
  type RouteHas,
} from "./server/route-rules.ts";

const CLIENT_MANIFEST_ID = "virtual:nextane-client-manifest";
const SERVER_MANIFEST_ID = "virtual:nextane-server-manifest";
const RESOLVED_CLIENT_MANIFEST_ID = `\0${CLIENT_MANIFEST_ID}`;
const RESOLVED_SERVER_MANIFEST_ID = `\0${SERVER_MANIFEST_ID}`;
const CLIENT_PAGE_QUERY = "nextane-client-page";
const SERVER_PAGE_EXPORTS = new Set([
  "config",
  "getInitialProps",
  "getServerSideProps",
  "getStaticPaths",
  "getStaticProps",
]);
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PUBLIC_RUNTIME_ALIASES = [
  ["nextane/client", "src/client.ts"],
  ["nextane/document", "src/runtime/document.tsrx"],
  ["nextane/head", "src/runtime/head.tsrx"],
  ["nextane/link", "src/runtime/link.tsrx"],
  ["nextane/router", "src/runtime/router.ts"],
  ["nextane/server", "src/server/handler.ts"],
  ["nextane/types", "src/types.ts"],
  ["nextane/worker", "worker.ts"],
].map(([find, source]) => ({
  find,
  replacement: path.join(PACKAGE_ROOT, source),
}));

interface RoutingConfig {
  rewrites: RewriteRule[];
  redirects: RedirectRule[];
  headers: HeaderRule[];
  crossOrigin?: string;
  trailingSlash: boolean;
}

const UNSUPPORTED_ROUTING_FILE_NAMES = ["middleware", "proxy"];
const ROUTING_FILE_EXTENSIONS = [
  "cjs",
  "cts",
  "js",
  "jsx",
  "mjs",
  "mts",
  "ts",
  "tsx",
];
const UNSUPPORTED_SECURITY_CONFIG = ["i18n"];

export function assertNoUnsupportedRoutingFiles(root: string) {
  const unsupported = ["", "src"].flatMap((directory) =>
    UNSUPPORTED_ROUTING_FILE_NAMES.flatMap((name) =>
      ROUTING_FILE_EXTENSIONS.map((extension) =>
        path.join(root, directory, `${name}.${extension}`),
      ),
    ),
  ).filter(existsSync);
  if (unsupported.length === 0) return;
  throw new Error(
    `[nextane] Refusing to build because Nextane does not execute Next.js ` +
      `middleware/proxy files: ${unsupported
        .map((file) => path.relative(root, file))
        .join(", ")}. Remove or explicitly migrate their behavior before building.`,
  );
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function astNode(value: unknown): AstNode | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { start?: unknown }).start === "number" &&
    typeof (value as { end?: unknown }).end === "number"
  ) {
    return value as AstNode;
  }
  return null;
}

function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const value of Object.values(node)) {
    const child = astNode(value);
    if (child) {
      children.push(child);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const arrayChild = astNode(item);
      if (arrayChild) children.push(arrayChild);
    }
  }
  return children;
}

function collectIdentifiers(node: AstNode): Set<string> {
  const names = new Set<string>();
  const visit = (current: AstNode) => {
    if (
      (current.type === "Identifier" || current.type === "JSXIdentifier") &&
      typeof current.name === "string"
    ) {
      names.add(current.name);
    }
    for (const child of childNodes(current)) visit(child);
  };
  visit(node);
  return names;
}

function bindingNames(pattern: AstNode | null): string[] {
  if (!pattern) return [];
  if (pattern.type === "Identifier" && typeof pattern.name === "string") {
    return [pattern.name];
  }
  if (pattern.type === "RestElement") {
    return bindingNames(astNode(pattern.argument));
  }
  if (pattern.type === "AssignmentPattern") {
    return bindingNames(astNode(pattern.left));
  }
  if (pattern.type === "Property") {
    return bindingNames(astNode(pattern.value));
  }
  return childNodes(pattern).flatMap(bindingNames);
}

function declarationNames(node: AstNode): string[] {
  if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
    return node.declarations.flatMap((declaration) => {
      const item = astNode(declaration);
      return item ? bindingNames(astNode(item.id)) : [];
    });
  }
  return bindingNames(astNode(node.id));
}

function declarationFromStatement(node: AstNode): AstNode | null {
  if (node.type === "ExportNamedDeclaration") {
    return astNode(node.declaration);
  }
  if (
    node.type.endsWith("Declaration") &&
    node.type !== "ImportDeclaration" &&
    node.type !== "ExportDefaultDeclaration"
  ) {
    return node;
  }
  return null;
}

function exportedName(
  specifier: AstNode,
  field: "local" | "exported",
): string | null {
  const value = astNode(specifier[field]);
  if (!value) return null;
  if (typeof value.name === "string") return value.name;
  if (typeof value.value === "string") return value.value;
  return null;
}

function applyTextEdits(source: string, edits: TextEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  }
  return result;
}

function isServerStaticAssignment(node: AstNode): boolean {
  if (node.type !== "ExpressionStatement") return false;
  const expression = astNode(node.expression);
  if (expression?.type !== "AssignmentExpression") return false;
  const left = astNode(expression.left);
  if (left?.type !== "MemberExpression") return false;
  const property = astNode(left.property);
  const name =
    typeof property?.name === "string"
      ? property.name
      : typeof property?.value === "string"
        ? property.value
        : null;
  return name !== null && SERVER_PAGE_EXPORTS.has(name);
}

function moduleBody(program: AstNode): AstNode[] {
  return Array.isArray(program.body)
    ? program.body.flatMap((item) => {
        const node = astNode(item);
        return node ? [node] : [];
      })
    : [];
}

function declarationGraph(body: AstNode[]) {
  return body.flatMap((statement) => {
    const declaration = declarationFromStatement(statement);
    if (!declaration) return [];
    const names = declarationNames(declaration);
    return names.length > 0
      ? [{ node: statement, names, references: collectIdentifiers(declaration) }]
      : [];
  });
}

function expandDeclarationReferences(
  initial: Set<string>,
  declarations: ReturnType<typeof declarationGraph>,
): Set<string> {
  const needed = new Set(initial);
  const expanded = new Set<AstNode>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (
        expanded.has(declaration.node) ||
        !declaration.names.some((name) => needed.has(name))
      ) {
        continue;
      }
      expanded.add(declaration.node);
      for (const name of declaration.references) {
        if (!needed.has(name)) {
          needed.add(name);
          changed = true;
        }
      }
    }
  }
  return needed;
}

function importSpecifierName(specifier: AstNode): string | null {
  const local = astNode(specifier.local);
  return typeof local?.name === "string" ? local.name : null;
}

function renderImport(
  node: AstNode,
  keptSpecifiers: AstNode[],
  source: string,
): string {
  const sourceNode = astNode(node.source);
  if (!sourceNode) return source.slice(node.start, node.end);
  const sourceText = source.slice(sourceNode.start, sourceNode.end);
  const suffix = source.slice(sourceNode.end, node.end);
  const defaultSpecifier = keptSpecifiers.find(
    (specifier) => specifier.type === "ImportDefaultSpecifier",
  );
  const namespaceSpecifier = keptSpecifiers.find(
    (specifier) => specifier.type === "ImportNamespaceSpecifier",
  );
  const namedSpecifiers = keptSpecifiers.filter(
    (specifier) => specifier.type === "ImportSpecifier",
  );
  const clauses: string[] = [];
  if (defaultSpecifier) {
    clauses.push(source.slice(defaultSpecifier.start, defaultSpecifier.end));
  }
  if (namespaceSpecifier) {
    clauses.push(
      source.slice(namespaceSpecifier.start, namespaceSpecifier.end),
    );
  }
  if (namedSpecifiers.length > 0) {
    clauses.push(
      `{ ${namedSpecifiers
        .map((specifier) => source.slice(specifier.start, specifier.end))
        .join(", ")} }`,
    );
  }
  const typePrefix = node.importKind === "type" ? "type " : "";
  return `import ${typePrefix}${clauses.join(", ")} from ${sourceText}${suffix}`;
}

function renderNamedExport(
  node: AstNode,
  keptSpecifiers: AstNode[],
  source: string,
): string {
  const sourceNode = astNode(node.source);
  const suffixStart = sourceNode
    ? sourceNode.end
    : keptSpecifiers.at(-1)?.end ?? node.end;
  const sourceClause = sourceNode
    ? ` from ${source.slice(sourceNode.start, sourceNode.end)}`
    : "";
  const typePrefix = node.exportKind === "type" ? "type " : "";
  return `export ${typePrefix}{ ${keptSpecifiers
    .map((specifier) => source.slice(specifier.start, specifier.end))
    .join(", ")} }${sourceClause}${source.slice(suffixStart, node.end)}`;
}

export async function createClientPageSource(
  source: string,
  fileName = "page.tsrx",
): Promise<string> {
  const extension = path.extname(fileName).slice(1);
  const language = extension === "jsx" || extension === "js" ? "jsx" : "tsx";
  const program = astNode(await parseAstAsync(source, { lang: language }));
  if (!program) throw new Error(`[nextane] Unable to parse client page ${fileName}`);

  const edits: TextEdit[] = [];
  const serverRoots: AstNode[] = [];
  const serverBindings = new Set(SERVER_PAGE_EXPORTS);
  const body = moduleBody(program);

  for (const statement of body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = astNode(statement.declaration);
    if (declaration) {
      for (const name of declarationNames(declaration)) {
        if (SERVER_PAGE_EXPORTS.has(name)) serverBindings.add(name);
      }
      continue;
    }
    if (!Array.isArray(statement.specifiers)) continue;
    for (const value of statement.specifiers) {
      const specifier = astNode(value);
      if (!specifier) continue;
      const local = exportedName(specifier, "local");
      const exported = exportedName(specifier, "exported");
      if (
        (local && SERVER_PAGE_EXPORTS.has(local)) ||
        (exported && SERVER_PAGE_EXPORTS.has(exported))
      ) {
        if (local) serverBindings.add(local);
        serverRoots.push(specifier);
      }
    }
  }

  for (const statement of body) {
    if (statement.type === "ExportAllDeclaration") {
      edits.push({ start: statement.start, end: statement.end, text: "" });
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      const declaration = astNode(statement.declaration);
      if (!declaration) {
        const specifiers = Array.isArray(statement.specifiers)
          ? statement.specifiers.flatMap((value) => {
              const specifier = astNode(value);
              return specifier ? [specifier] : [];
            })
          : [];
        const kept = specifiers.filter((specifier) => {
          const local = exportedName(specifier, "local");
          const exported = exportedName(specifier, "exported");
          return !(
            (local && serverBindings.has(local)) ||
            (exported && serverBindings.has(exported))
          );
        });
        edits.push({
          start: statement.start,
          end: statement.end,
          text:
            kept.length === 0
              ? ""
              : renderNamedExport(statement, kept, source),
        });
        continue;
      }
      const names = declarationNames(declaration);
      const serverNames = names.filter((name) => serverBindings.has(name));
      if (serverNames.length > 0) {
        if (serverNames.length !== names.length) {
          throw new Error(
            `[nextane] ${fileName} declares server and client exports together. ` +
              `Declare ${serverNames.join(", ")} separately so it can be excluded from the browser bundle.`,
          );
        }
        serverRoots.push(declaration);
        edits.push({ start: statement.start, end: statement.end, text: "" });
      } else {
        edits.push({
          start: statement.start,
          end: statement.end,
          text: source.slice(declaration.start, declaration.end),
        });
      }
      continue;
    }
    const declaration = declarationFromStatement(statement);
    if (declaration) {
      const names = declarationNames(declaration);
      const serverNames = names.filter((name) => serverBindings.has(name));
      if (serverNames.length > 0) {
        if (serverNames.length !== names.length) {
          throw new Error(
            `[nextane] ${fileName} mixes server-only and client declarations. ` +
              `Declare ${serverNames.join(", ")} separately.`,
          );
        }
        serverRoots.push(declaration);
        edits.push({ start: statement.start, end: statement.end, text: "" });
      }
      continue;
    }
    if (isServerStaticAssignment(statement)) {
      serverRoots.push(statement);
      edits.push({ start: statement.start, end: statement.end, text: "" });
    }
  }

  let clientSource = applyTextEdits(source, edits);
  const clientProgram = astNode(
    await parseAstAsync(clientSource, { lang: language }),
  );
  if (!clientProgram) {
    throw new Error(`[nextane] Unable to create client page ${fileName}`);
  }
  const clientBody = moduleBody(clientProgram);
  const declarations = declarationGraph(clientBody);
  const serverReferences = expandDeclarationReferences(
    new Set(serverRoots.flatMap((root) => [...collectIdentifiers(root)])),
    declarations,
  );
  const clientRootNodes = clientBody.filter(
    (statement) =>
      statement.type === "ExportDefaultDeclaration" ||
      (!declarationFromStatement(statement) &&
        statement.type !== "ImportDeclaration"),
  );
  const clientReferences = expandDeclarationReferences(
    new Set(clientRootNodes.flatMap((root) => [...collectIdentifiers(root)])),
    declarations,
  );

  const dependencyEdits: TextEdit[] = [];
  for (const declaration of declarations) {
    const serverOnly = declaration.names.filter(
      (name) => serverReferences.has(name) && !clientReferences.has(name),
    );
    if (serverOnly.length === 0) continue;
    if (serverOnly.length !== declaration.names.length) {
      throw new Error(
        `[nextane] ${fileName} mixes server-only dependencies with client bindings. ` +
          `Declare ${serverOnly.join(", ")} separately.`,
      );
    }
    dependencyEdits.push({
      start: declaration.node.start,
      end: declaration.node.end,
      text: "",
    });
  }

  for (const statement of clientBody) {
    if (statement.type !== "ImportDeclaration") continue;
    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers.flatMap((value) => {
          const specifier = astNode(value);
          return specifier ? [specifier] : [];
        })
      : [];
    if (specifiers.length === 0) continue;
    const kept = specifiers.filter((specifier) => {
      const name = importSpecifierName(specifier);
      return (
        !name ||
        !serverReferences.has(name) ||
        clientReferences.has(name)
      );
    });
    if (kept.length === specifiers.length) continue;
    dependencyEdits.push({
      start: statement.start,
      end: statement.end,
      text:
        kept.length === 0 ? "" : renderImport(statement, kept, clientSource),
    });
  }

  clientSource = applyTextEdits(clientSource, dependencyEdits);
  return clientSource;
}

export async function loadRoutingConfig(root: string): Promise<RoutingConfig> {
  assertNoUnsupportedRoutingFiles(root);
  const candidates = [
    "nextane.config.cjs",
    "next.config.cjs",
    "nextane.config.cts",
    "next.config.cts",
    "nextane.config.js",
    "next.config.js",
    "nextane.config.ts",
    "next.config.ts",
    "nextane.config.mjs",
    "next.config.mjs",
    "nextane.config.mts",
    "next.config.mts",
  ];
  const configPath = candidates
    .map((candidate) => path.join(root, candidate))
    .find(existsSync);
  if (!configPath) {
    return { rewrites: [], redirects: [], headers: [], trailingSlash: false };
  }

  let loaded: unknown;
  try {
    const require = createRequire(path.join(root, "__nextane_config__.cjs"));
    delete require.cache[require.resolve(configPath)];
    loaded = require(configPath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_REQUIRE_ESM"
    ) {
      throw error;
    }
    loaded = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  }

  let nextConfig =
    loaded &&
    typeof loaded === "object" &&
    "default" in loaded
      ? (loaded as { default: unknown }).default
      : loaded;
  if (typeof nextConfig === "function") {
    nextConfig = await nextConfig("phase-production-build", {
      defaultConfig: {},
    });
  }
  const config =
    nextConfig && typeof nextConfig === "object"
      ? (nextConfig as Record<string, unknown>)
      : {};
  const unsupportedConfig = UNSUPPORTED_SECURITY_CONFIG.filter(
    (name) => Object.hasOwn(config, name) && config[name] != null,
  );
  if (unsupportedConfig.length > 0) {
    throw new Error(
      `[nextane] Refusing to build because these Next.js configuration APIs ` +
        `are not implemented and may contain security policy: ${unsupportedConfig.join(", ")}. ` +
        `Migrate them explicitly before building.`,
    );
  }
  const rewriteValue =
    typeof config.rewrites === "function" ? await config.rewrites() : [];
  const rewriteGroups =
    Array.isArray(rewriteValue)
      ? rewriteValue
      : rewriteValue && typeof rewriteValue === "object"
        ? [
            ...(Array.isArray((rewriteValue as Record<string, unknown>).beforeFiles)
              ? ((rewriteValue as Record<string, unknown>).beforeFiles as unknown[])
              : []),
            ...(Array.isArray((rewriteValue as Record<string, unknown>).afterFiles)
              ? ((rewriteValue as Record<string, unknown>).afterFiles as unknown[])
              : []),
            ...(Array.isArray((rewriteValue as Record<string, unknown>).fallback)
              ? ((rewriteValue as Record<string, unknown>).fallback as unknown[])
              : []),
          ]
        : [];
  const rewrites = rewriteGroups.flatMap((rewrite) =>
    sanitizeRewriteRule(rewrite),
  );
  const redirectValue =
    typeof config.redirects === "function" ? await config.redirects() : [];
  const redirects = (Array.isArray(redirectValue) ? redirectValue : []).flatMap(
    (redirect) => sanitizeRedirectRule(redirect),
  );
  const headerValue =
    typeof config.headers === "function" ? await config.headers() : [];
  const headers = (Array.isArray(headerValue) ? headerValue : []).flatMap(
    (header) => sanitizeHeaderRule(header),
  );

  for (const rule of rewrites) validateRuleSource(rule.source, "rewrite");
  for (const rule of redirects) validateRuleSource(rule.source, "redirect");
  for (const rule of headers) validateRuleSource(rule.source, "header");

  return {
    rewrites,
    redirects,
    headers,
    trailingSlash: config.trailingSlash === true,
    ...(typeof config.crossOrigin === "string"
      ? { crossOrigin: config.crossOrigin }
      : {}),
  };
}

function sanitizeHasList(value: unknown): RouteHas[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const conditions = value.flatMap((item): RouteHas[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const type = candidate.type;
    if (
      type !== "header" &&
      type !== "cookie" &&
      type !== "query" &&
      type !== "host"
    ) {
      return [];
    }
    const key = typeof candidate.key === "string" ? candidate.key : "";
    if (type !== "host" && key === "") return [];
    return [
      {
        type,
        key,
        ...(typeof candidate.value === "string"
          ? { value: candidate.value }
          : {}),
      },
    ];
  });
  return conditions.length > 0 ? conditions : undefined;
}

function baseRuleFields(candidate: Record<string, unknown>) {
  const has = sanitizeHasList(candidate.has);
  const missing = sanitizeHasList(candidate.missing);
  return {
    ...(has ? { has } : {}),
    ...(missing ? { missing } : {}),
    ...(candidate.basePath === false ? { basePath: false as const } : {}),
  };
}

function sanitizeRewriteRule(value: unknown): RewriteRule[] {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).source !== "string" ||
    typeof (value as Record<string, unknown>).destination !== "string"
  ) {
    return [];
  }
  const candidate = value as Record<string, unknown>;
  return [
    {
      source: candidate.source as string,
      destination: candidate.destination as string,
      ...baseRuleFields(candidate),
    },
  ];
}

function sanitizeRedirectRule(value: unknown): RedirectRule[] {
  const base = sanitizeRewriteRule(value);
  if (base.length === 0) return [];
  const candidate = value as Record<string, unknown>;
  return [
    {
      ...base[0],
      ...(candidate.permanent === true ? { permanent: true } : {}),
      ...(typeof candidate.statusCode === "number"
        ? { statusCode: candidate.statusCode }
        : {}),
    },
  ];
}

function sanitizeHeaderRule(value: unknown): HeaderRule[] {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).source !== "string" ||
    !Array.isArray((value as Record<string, unknown>).headers)
  ) {
    return [];
  }
  const candidate = value as Record<string, unknown>;
  const headers = (candidate.headers as unknown[]).flatMap((header) => {
    if (
      !header ||
      typeof header !== "object" ||
      typeof (header as Record<string, unknown>).key !== "string" ||
      typeof (header as Record<string, unknown>).value !== "string"
    ) {
      return [];
    }
    return [
      {
        key: (header as { key: string }).key,
        value: (header as { value: string }).value,
      },
    ];
  });
  if (headers.length === 0) return [];
  return [
    {
      source: candidate.source as string,
      headers,
      ...baseRuleFields(candidate),
    },
  ];
}

function viteFileId(filePath: string): string {
  return `/@fs${filePath.split(path.sep).join("/")}`;
}

function clientPageFileId(filePath: string): string {
  return `${viteFileId(filePath)}?${CLIENT_PAGE_QUERY}`;
}

export function javascriptStringLiteral(value: string): string {
  let literal = '"';
  for (let index = 0; index < value.length; index += 1) {
    literal += `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return `${literal}"`;
}

function serializeJavascriptValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Cannot serialize undefined into a virtual module");
  }
  return `JSON.parse(${javascriptStringLiteral(json)})`;
}

function serializePublicRoute(route: {
  route: string;
  regexSource: string;
  params: unknown;
}): string {
  return serializeJavascriptValue({
    route: route.route,
    regexSource: route.regexSource,
    params: route.params,
  });
}

async function clientManifestSource(root: string): Promise<string> {
  const routes = (await scanPages(root)).filter((route) => route.kind === "page");
  const appPath = await findSpecialPage(root, "_app");
  const errorPath = await findSpecialPage(root, "_error");

  const loaderEntries = routes.map(
    (route) =>
      `${javascriptStringLiteral(route.route)}: () => import(${javascriptStringLiteral(clientPageFileId(route.filePath))})`,
  );

  return `
export const routes = [${routes.map(serializePublicRoute).join(",")}];
export const pageLoaders = {${loaderEntries.join(",")}};
export const appLoader = ${
    appPath
      ? `() => import(${javascriptStringLiteral(clientPageFileId(appPath))})`
      : "null"
  };
export const errorLoader = ${
    errorPath
      ? `() => import(${javascriptStringLiteral(clientPageFileId(errorPath))})`
      : "null"
  };
`;
}

interface PreviewManifestCredentials {
  previewModeId: string;
  encryptionKey: string;
  signingKey: string;
}

function previewCredentialFromEnv(
  name: string,
  pattern: RegExp,
  fallbackBytes: number,
): string {
  const value = process.env[name];
  if (value === undefined) return randomBytes(fallbackBytes).toString("hex");
  if (!pattern.test(value)) {
    throw new Error(
      `[nextane] ${name} must be a hex string matching ${pattern}`,
    );
  }
  return value;
}

export function createPreviewCredentials(): PreviewManifestCredentials {
  return {
    previewModeId: previewCredentialFromEnv(
      "NEXTANE_PREVIEW_MODE_ID",
      /^[0-9a-f]{16,64}$/i,
      16,
    ),
    encryptionKey: previewCredentialFromEnv(
      "NEXTANE_PREVIEW_ENCRYPTION_KEY",
      /^[0-9a-f]{64}$/i,
      32,
    ),
    signingKey: previewCredentialFromEnv(
      "NEXTANE_PREVIEW_SIGNING_KEY",
      /^[0-9a-f]{64}$/i,
      32,
    ),
  };
}

async function serverManifestSource(
  root: string,
  buildId: string,
  preview: PreviewManifestCredentials,
): Promise<string> {
  const routes = await scanPages(root);
  const appPath = await findSpecialPage(root, "_app");
  const documentPath = await findSpecialPage(root, "_document");
  const errorPath = await findSpecialPage(root, "_error");
  const routingConfig = await loadRoutingConfig(root);

  const routeEntries = routes.map(
    (route, index) =>
      `{...${serializePublicRoute(route)}, kind:${javascriptStringLiteral(route.kind)}, load: () => import(${javascriptStringLiteral(viteFileId(route.filePath))}), id:${index}}`,
  );

  return `
export const buildId = ${javascriptStringLiteral(buildId)};
export const routes = [${routeEntries.join(",")}];
export const loadApp = ${
    appPath
      ? `() => import(${javascriptStringLiteral(viteFileId(appPath))})`
      : "null"
  };
export const loadDocument = ${
    documentPath
      ? `() => import(${javascriptStringLiteral(viteFileId(documentPath))})`
      : "null"
  };
export const loadError = ${
    errorPath
      ? `() => import(${javascriptStringLiteral(viteFileId(errorPath))})`
      : "null"
  };
export const config = ${serializeJavascriptValue(routingConfig)};
export const preview = ${serializeJavascriptValue(preview)};
`;
}

function invalidateManifest(server: ViteDevServer, id: string) {
  const module = server.moduleGraph.getModuleById(id);
  if (module) server.moduleGraph.invalidateModule(module);
}

export function nextane(): Plugin {
  let config: ResolvedConfig;
  const buildId = process.env.NEXTANE_BUILD_ID ?? randomUUID();
  const previewCredentials = createPreviewCredentials();

  return {
    name: "nextane",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: PUBLIC_RUNTIME_ALIASES,
        },
        optimizeDeps: {
          exclude: [
            "nextane",
            "nextane/client",
            "nextane/document",
            "nextane/head",
            "nextane/link",
            "nextane/router",
            "nextane/server",
            "nextane/types",
            "nextane/worker",
            "octane",
          ],
        },
      };
    },
    configResolved(resolved) {
      config = resolved;
      if (resolved.command === "build" && resolved.build.sourcemap) {
        resolved.logger.warn(
          "[nextane] Production browser source maps were disabled to avoid publishing application source.",
        );
        resolved.build.sourcemap = false;
      }
    },
    async buildStart() {
      assertNoUnsupportedRoutingFiles(config.root);
      await loadRoutingConfig(config.root);
    },
    outputOptions(options) {
      return {
        ...options,
        sourcemap: false,
      };
    },
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName.endsWith(".map")) {
          delete bundle[fileName];
          continue;
        }
        if (output.type === "chunk") {
          output.map = null;
          output.code = output.code.replace(
            /\n?\/\/# sourceMappingURL=.*?(?:\n|$)/g,
            "\n",
          );
        }
      }
    },
    async resolveId(id, importer, options) {
      if (id === CLIENT_MANIFEST_ID) return RESOLVED_CLIENT_MANIFEST_ID;
      if (id === SERVER_MANIFEST_ID) return RESOLVED_SERVER_MANIFEST_ID;
      if (
        id === "octane" &&
        (options?.ssr === true ||
          this.environment?.config?.consumer === "server")
      ) {
        // Plain (non-.tsrx) server modules must get the server runtime; the
        // octane plugin's own remap only fires for the legacy ssr flag.
        const resolved = await this.resolve("octane/server", importer, {
          skipSelf: true,
        });
        return resolved?.id ?? null;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_CLIENT_MANIFEST_ID) return clientManifestSource(config.root);
      if (id === RESOLVED_SERVER_MANIFEST_ID) {
        return serverManifestSource(config.root, buildId, previewCredentials);
      }
      return null;
    },
    async transform(code, id) {
      const queryIndex = id.indexOf("?");
      if (queryIndex < 0) return null;
      const query = new URLSearchParams(id.slice(queryIndex + 1));
      if (!query.has(CLIENT_PAGE_QUERY)) return null;
      const fileName = id.slice(0, queryIndex);
      return {
        code: await createClientPageSource(code, fileName),
        map: null,
      };
    },
    configureServer(server) {
      const pagesDirectory = path.join(config.root, "pages");
      server.watcher.add(pagesDirectory);
      const refresh = (filePath: string) => {
        if (!filePath.startsWith(pagesDirectory)) return;
        invalidateManifest(server, RESOLVED_CLIENT_MANIFEST_ID);
        invalidateManifest(server, RESOLVED_SERVER_MANIFEST_ID);
        server.ws.send({ type: "full-reload", path: "*" });
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
    handleHotUpdate(context: HmrContext) {
      if (context.file.startsWith(path.join(config.root, "pages"))) {
        invalidateManifest(context.server, RESOLVED_CLIENT_MANIFEST_ID);
        invalidateManifest(context.server, RESOLVED_SERVER_MANIFEST_ID);
      }
    },
  };
}

export default nextane;
