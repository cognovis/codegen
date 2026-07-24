import pc from 'picocolors';
import assert4 from 'assert';
import * as fs from 'fs';
import fs__default, { existsSync } from 'fs';
import * as Path5 from 'path';
import Path5__default, { join } from 'path';
import { CanonicalManager } from '@atomic-ehr/fhir-canonical-manager';
import { fileURLToPath } from 'url';
import * as fsPromises from 'fs/promises';
import { readdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import YAML__default from 'yaml';
import * as fhirschema from '@atomic-ehr/fhirschema';
import { isStructureDefinition } from '@atomic-ehr/fhirschema';
import { spawn } from 'child_process';
import * as util from 'util';
import Mustache from 'mustache';

var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var LEVEL_PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 };
function mkLogger(opts = {}) {
  const prefix = opts.prefix ?? "";
  const suppressedSet = new Set(opts.suppressTags ?? []);
  const tagCounts = {};
  const entries = [];
  const drySet = /* @__PURE__ */ new Set();
  const currentLevel = opts.level ?? "INFO";
  const shouldLog = (level) => LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
  const colorize = {
    DEBUG: (s) => s,
    INFO: (s) => s,
    WARN: pc.yellow,
    ERROR: pc.red,
    SILENT: (s) => s
  };
  const fmt = (level, icon, msg, tag) => {
    const pfx = prefix ? `${prefix}: ` : "";
    const tagSuffix = tag ? ` ${pc.dim(`(${tag})`)}` : "";
    return colorize[level](`${icon} ${pfx}${msg}`) + tagSuffix;
  };
  const pushEntry = (level, msg, tag, suppressed = false) => {
    entries.push({ level, tag, message: msg, suppressed, prefix, timestamp: Date.now() });
  };
  const mkLogFn = (level, icon, consoleFn, dedupe = false) => {
    return (...args) => {
      const tag = args.length === 2 ? args[0] : void 0;
      const msg = args.length === 2 ? args[1] : args[0];
      if (tag) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      const isSuppressed = tag !== void 0 && suppressedSet.has(tag);
      pushEntry(level, msg, tag, isSuppressed);
      if (isSuppressed) return;
      if (!shouldLog(level)) return;
      if (dedupe) {
        const key = `${level}::${tag ?? ""}::${msg}`;
        if (drySet.has(key)) return;
        drySet.add(key);
      }
      consoleFn(fmt(level, icon, msg, tag));
    };
  };
  const logger = {
    warn: mkLogFn("WARN", "!", console.warn),
    dryWarn: mkLogFn("WARN", "!", console.warn, true),
    info: mkLogFn("INFO", "i", console.log),
    error: mkLogFn("ERROR", "X", console.error),
    debug: mkLogFn("DEBUG", "D", console.log),
    fork(childPrefix, childOpts) {
      const fullPrefix = prefix ? `${prefix}/${childPrefix}` : childPrefix;
      const merged = [...suppressedSet, ...childOpts?.suppressTags ?? []];
      return mkLogger({
        prefix: fullPrefix,
        suppressTags: merged,
        level: childOpts?.level ?? currentLevel
      });
    },
    as() {
      return logger;
    },
    tagCounts() {
      return tagCounts;
    },
    printTagSummary() {
      const allTags = Object.entries(tagCounts);
      if (allTags.length === 0) return;
      const pfx = prefix ? `${prefix}: ` : "";
      const emitted = allTags.filter(([tag]) => !suppressedSet.has(tag));
      const suppressed = allTags.filter(([tag]) => suppressedSet.has(tag));
      if (emitted.length > 0) {
        const total = emitted.reduce((sum, [, c]) => sum + c, 0);
        const detail = emitted.map(([tag, c]) => `${tag}: ${c}`).join(", ");
        console.warn(pc.yellow(`! ${pfx}${total} warnings (${detail})`));
      }
      if (suppressed.length > 0) {
        const total = suppressed.reduce((sum, [, c]) => sum + c, 0);
        const detail = suppressed.map(([tag, c]) => `${tag}: ${c}`).join(", ");
        console.log(pc.dim(`i ${pfx}${total} suppressed (${detail})`));
      }
    },
    buffer() {
      return entries;
    },
    bufferClear() {
      entries.length = 0;
    }
  };
  return logger;
}

// src/utils/log.ts
var mkCodegenLogger = (opts = {}) => mkLogger(opts);

// src/api/writer-generator/utils.ts
var WORD_SPLIT_RE = /(?<=[a-z])(?=[A-Z])|[-_.\s]/;
var words = (s) => {
  return s.split(WORD_SPLIT_RE).filter(Boolean);
};
var kebabCase = (s) => {
  return words(s).map((s2) => s2.toLowerCase()).join("-");
};
var capitalCase = (s) => {
  if (s.length === 0) throw new Error("Empty string");
  return s[0]?.toUpperCase() + s.substring(1).toLowerCase();
};
var camelCase = (s) => {
  if (s.length === 0) throw new Error("Empty string");
  const [first, ...rest] = words(s);
  return [first?.toLowerCase(), ...rest.map(capitalCase)].join("");
};
var pascalCase = (s) => {
  return words(s).map(capitalCase).join("");
};
var snakeCase = (s) => {
  return words(s).map((s2) => s2.toLowerCase()).join("_");
};
var uppercaseFirstLetter = (str) => {
  if (!str || str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};
var uppercaseFirstLetterOfEach = (strings) => {
  return strings.map((str) => uppercaseFirstLetter(str));
};
var FileSystemWriter = class {
  opts;
  currentDir;
  currentFile;
  writtenFilesBuffer = {};
  constructor(opts) {
    this.opts = opts;
  }
  setOutputDir(path) {
    if (this.currentDir) throw new Error("Can't change output dir while writing");
    this.opts.outputDir = path;
  }
  logger() {
    return this.opts.logger;
  }
  onDiskMkDir(path) {
    if (this.opts.inMemoryOnly) return;
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  }
  onDiskOpenFile(relPath) {
    if (this.opts.inMemoryOnly) return -1;
    return fs.openSync(relPath, "w");
  }
  onDiskCloseFile(descriptor) {
    if (this.opts.inMemoryOnly) return;
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  }
  onDiskWrite(descriptor, token) {
    if (this.opts.inMemoryOnly) return;
    fs.writeSync(descriptor, token);
  }
  cd(path, gen) {
    const prev = this.currentDir;
    this.currentDir = path.startsWith("/") ? Path5.join(this.opts.outputDir, path) : Path5.join(this.currentDir ?? this.opts.outputDir, path);
    this.onDiskMkDir(this.currentDir);
    this.logger()?.debug(`cd '${this.currentDir}'`);
    gen();
    this.currentDir = prev;
  }
  cat(fn, gen) {
    if (!this.currentDir) throw new Error("Should be in a directory (`cd`)");
    if (this.currentFile) throw new Error("Can't open file when another file is open");
    if (fn.includes("/")) throw new Error(`Change file path separatly: ${fn}`);
    const relPath = Path5.normalize(`${this.currentDir}/${fn}`);
    if (this.writtenFilesBuffer[relPath]) {
      this.logger()?.warn(`File will be rewritten '${relPath}'`);
      this.logger()?.debug(`File content: ${this.writtenFilesBuffer[relPath].tokens.join("")}`);
    }
    try {
      const descriptor = this.onDiskOpenFile(relPath);
      this.logger()?.debug(`cat > '${relPath}'`);
      this.currentFile = { descriptor, relPath };
      this.writtenFilesBuffer[this.currentFile.relPath] = {
        relPath,
        absPath: Path5.resolve(relPath),
        tokens: []
      };
      gen();
    } finally {
      if (this.currentFile) this.onDiskCloseFile(this.currentFile.descriptor);
      this.currentFile = void 0;
    }
  }
  write(str) {
    if (!this.currentFile) throw new Error("No file opened");
    this.onDiskWrite(this.currentFile.descriptor, str);
    const buf = this.writtenFilesBuffer[this.currentFile.relPath];
    if (!buf) throw new Error("No buffer found");
    buf.tokens.push(str);
  }
  copyAssets(source, destination) {
    destination = Path5.normalize(`${this.currentDir ?? this.opts.outputDir}/${destination}`);
    const content = fs.readFileSync(source, "utf8");
    this.writtenFilesBuffer[destination] = {
      relPath: destination,
      absPath: Path5.resolve(destination),
      tokens: [content]
    };
    fs.cpSync(source, destination);
  }
  cp(source, destination) {
    if (!this.opts.resolveAssets) throw new Error("resolveAssets is not defined");
    source = Path5.resolve(this.opts.resolveAssets(source));
    destination = Path5.normalize(`${this.currentDir ?? this.opts.outputDir}/${destination}`);
    const content = fs.readFileSync(source, "utf8");
    this.writtenFilesBuffer[destination] = {
      relPath: destination,
      absPath: Path5.resolve(destination),
      tokens: [content]
    };
    fs.cpSync(source, destination);
  }
  writtenFiles() {
    return Object.values(this.writtenFilesBuffer).map(({ relPath, absPath, tokens }) => {
      return { relPath, absPath, content: tokens.join("") };
    }).sort((a, b) => a.relPath.localeCompare(b.relPath));
  }
  async flushAsync() {
    const files = this.writtenFiles();
    const dirs = /* @__PURE__ */ new Set();
    for (const file of files) {
      dirs.add(Path5.dirname(file.absPath));
    }
    await Promise.all(Array.from(dirs).map((dir) => fsPromises.mkdir(dir, { recursive: true })));
    await Promise.all(files.map((file) => fsPromises.writeFile(file.absPath, file.content)));
  }
  async generateAsync(tsIndex) {
    const originalInMemoryOnly = this.opts.inMemoryOnly;
    this.opts.inMemoryOnly = true;
    try {
      await this.generate(tsIndex);
    } finally {
      this.opts.inMemoryOnly = originalInMemoryOnly;
    }
    await this.flushAsync();
  }
};
var Writer = class extends FileSystemWriter {
  currentIndent = 0;
  indent() {
    this.currentIndent += this.opts.tabSize;
  }
  deindent() {
    this.currentIndent -= this.opts.tabSize;
  }
  writeIndent() {
    this.write(" ".repeat(this.currentIndent));
  }
  line(...tokens) {
    if (tokens.length === 0) {
      this.write("\n");
    } else {
      this.writeIndent();
      this.write(`${tokens.join(" ")}
`);
    }
  }
  lineSM(...tokens) {
    this.writeIndent();
    this.write(`${tokens.join(" ")};
`);
  }
  comment(...tokens) {
    const lines = tokens.join(" ").split("\n");
    for (const line of lines) {
      this.line(this.opts.commentLinePrefix, line);
    }
  }
  debugComment(...tokens) {
    if (this.opts.withDebugComment) {
      tokens = tokens.map((token) => {
        if (typeof token === "string") {
          return token;
        }
        return JSON.stringify(token, null, 2);
      });
      this.comment(...tokens);
    }
  }
  disclaimer() {
    return [
      "WARNING: This file is autogenerated by @atomic-ehr/codegen.",
      "GitHub: https://github.com/atomic-ehr/codegen",
      "Any manual changes made to this file may be overwritten."
    ];
  }
  generateDisclaimer() {
    this.disclaimer().forEach((e) => {
      this.comment(e);
    });
    this.line();
  }
  indentBlock(gencontent) {
    this.indent();
    gencontent();
    this.deindent();
  }
  curlyBlock(tokens, gencontent, endTokens) {
    this.line(`${tokens.filter(Boolean).join(" ")} {`);
    this.indent();
    gencontent();
    this.deindent();
    this.line(`}${endTokens?.filter(Boolean).join(" ") ?? ""}`);
  }
  squareBlock(tokens, gencontent, endTokens) {
    this.line(`${tokens.filter(Boolean).join(" ")} [`);
    this.indent();
    gencontent();
    this.deindent();
    this.line(`]${endTokens?.filter(Boolean).join(" ") ?? ""}`);
  }
};
var LEADING_DIGIT_RE = /^\d/;
var extractNameFromCanonical = (canonical, dropFragment = true) => {
  let localName = canonical.split("/").pop();
  if (!localName) return void 0;
  if (dropFragment && localName.includes("#")) {
    localName = localName.split("#")[0];
  }
  if (!localName) return void 0;
  if (LEADING_DIGIT_RE.test(localName)) {
    localName = `number_${localName}`;
  }
  return localName;
};
var packageMeta = (schema) => {
  return {
    name: schema.identifier.package,
    version: schema.identifier.version
  };
};
var packageMetaToFhir = (packageMeta2) => `${packageMeta2.name}#${packageMeta2.version}`;
var packageMetaToNpm = (packageMeta2) => `${packageMeta2.name}@${packageMeta2.version}`;
var hashSchema = (schema) => {
  const json = JSON.stringify(schema);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
};
var enrichFHIRSchema = (schema, packageMeta2) => {
  const derivation = schema.derivation === "constraint" ? "constraint" : "specialization";
  return {
    ...schema,
    derivation,
    kind: schema.kind,
    package_meta: schema.package_meta || packageMeta2,
    name: schema.name,
    url: schema.url,
    base: schema.base
  };
};
var isResourceIdentifier = (id) => {
  return id?.kind === "resource";
};
var isComplexTypeIdentifier = (id) => {
  return id?.kind === "complex-type";
};
var isPrimitiveIdentifier = (id) => {
  return id?.kind === "primitive-type";
};
var isNestedIdentifier = (id) => {
  return id?.kind === "nested";
};
var isProfileIdentifier = (id) => {
  return id?.kind === "profile";
};
var isSnapshotProfileIdentifier = (id) => {
  return id?.kind === "profile-snapshot";
};
var snapshotIdentifier = (id) => ({
  ...id,
  kind: "profile-snapshot"
});
var concatIdentifiers = (...sources) => {
  const entries = sources.filter((s) => s !== void 0).flatMap((s) => s.map((id) => [id.url, id]));
  if (entries.length === 0) return void 0;
  const deduped = Object.values(Object.fromEntries(entries));
  return deduped.sort((a, b) => a.url.localeCompare(b.url));
};
var isNestedTypeSchema = (schema) => {
  return schema !== void 0 && isNestedIdentifier(schema.identifier);
};
var isSpecializationTypeSchema = (schema) => {
  return schema?.identifier.kind === "resource" || schema?.identifier.kind === "complex-type" || schema?.identifier.kind === "logical";
};
var isComplexTypeTypeSchema = (schema) => {
  return schema?.identifier.kind === "complex-type";
};
var isResourceTypeSchema = (schema) => {
  return schema?.identifier.kind === "resource";
};
var isPrimitiveTypeSchema = (schema) => {
  return schema?.identifier.kind === "primitive-type";
};
var isLogicalTypeSchema = (schema) => {
  return schema?.identifier.kind === "logical";
};
var isProfileTypeSchema = (schema) => {
  return schema?.identifier.kind === "profile";
};
var isBindingSchema = (schema) => {
  return schema?.identifier.kind === "binding";
};
var isValueSetTypeSchema = (schema) => {
  return schema?.identifier.kind === "value-set";
};
var isSnapshotProfileTypeSchema = (s) => {
  return s?.identifier.kind === "profile-snapshot";
};
var extractExtensionDeps = (ext) => [
  ...ext.valueFieldTypes ?? [],
  ...ext.profile ? [ext.profile] : [],
  ...ext.subExtensions?.flatMap((sub) => sub.valueFieldType ? [sub.valueFieldType] : []) ?? []
];
var isNotChoiceDeclarationField = (field) => {
  if (!field) return false;
  return field.choices === void 0;
};
var isChoiceDeclarationField = (field) => {
  if (!field) return false;
  return field.choices !== void 0;
};
var isChoiceInstanceField = (field) => {
  if (!field) return false;
  return field.choiceOf !== void 0;
};
var enrichValueSet = (vs, packageMeta2) => {
  if (!vs.url) throw new Error("ValueSet must have a URL");
  if (!vs.name) throw new Error("ValueSet must have a name");
  return {
    ...vs,
    package_meta: vs.package_meta || packageMeta2,
    name: vs.name,
    url: vs.url
  };
};

// src/api/writer-generator/csharp/formatHelper.ts
var ops = {
  "!": "Not",
  "<=": "LessOrEqual",
  ">=": "GreaterOrEqual",
  "<": "Less",
  ">": "Greater",
  "=": "Equal",
  "-": "Dash",
  "+": "Plus",
  "*": "Asterisk",
  "/": "Slash",
  "%": "Percent",
  "&": "And",
  "|": "Or",
  "^": "Xor",
  "~": "Tilde",
  "?": "Question",
  ".": "Dot"
};
function formatEnumDashHandle(entry) {
  return entry.split("-").map((part) => uppercaseFirstLetter(part)).join("-");
}
function formatEnumEntryOperation(entry) {
  let res = entry;
  for (const op in ops) res = res.replaceAll(op, ops[op] ?? "");
  return res;
}
function formatEnumNumber(entry) {
  const num = Number(entry[0]);
  if (Number.isInteger(num) && !Number.isNaN(num)) {
    return `_${entry}`;
  }
  return entry;
}
function formatEnumEntry(entry) {
  let res = formatEnumDashHandle(entry);
  res = formatEnumNumber(res);
  res = formatEnumEntryOperation(res);
  res = uppercaseFirstLetter(res);
  return res;
}
function formatName(input) {
  return uppercaseFirstLetter(camelCase(input.replaceAll(".", "-")));
}

// src/api/writer-generator/csharp/csharp.ts
var resolveCSharpAssets = (fn) => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = Path5__default.dirname(__filename);
  if (__filename.endsWith("dist/index.js")) {
    return Path5__default.resolve(__dirname, "..", "assets", "api", "writer-generator", "csharp", fn);
  }
  return Path5__default.resolve(__dirname, "../../../..", "assets", "api", "writer-generator", "csharp", fn);
};
var PRIMITIVE_TYPE_MAP = {
  boolean: "bool",
  instant: "string",
  time: "string",
  date: "string",
  dateTime: "string",
  decimal: "decimal",
  integer: "int",
  unsignedInt: "long",
  positiveInt: "long",
  integer64: "long",
  base64Binary: "string",
  uri: "string",
  url: "string",
  canonical: "string",
  oid: "string",
  uuid: "string",
  string: "string",
  code: "string",
  markdown: "string",
  id: "string",
  xhtml: "string"
};
var RESERVED_TYPE_NAMES = ["Reference", "Expression"];
var getFieldModifiers = (field) => {
  return field.required ? ["required"] : [];
};
var formatClassName = (schema) => {
  const name = prefixReservedTypeName(getResourceName(schema.identifier));
  return uppercaseFirstLetter(name);
};
var formatBaseClass = (schema) => {
  return schema.base ? `: ${schema.base.name}` : "";
};
var LEADING_DIGIT_RE2 = /^\d/;
var canonicalToName = (canonical, dropFragment = true) => {
  if (!canonical) return void 0;
  let localName = canonical.split("/").pop();
  if (!localName) return void 0;
  if (dropFragment && localName.includes("#")) localName = localName.split("#")[0];
  if (!localName) return void 0;
  if (LEADING_DIGIT_RE2.test(localName)) {
    localName = `number_${localName}`;
  }
  return formatName(localName);
};
var getResourceName = (id) => {
  if (id.kind === "nested") {
    const url = id.url;
    const path = canonicalToName(url, false);
    if (!path) return "";
    const [resourceName, fragment] = path.split("#");
    const name = uppercaseFirstLetterOfEach((fragment ?? "").split(".")).join("");
    return formatName([resourceName, name].join(""));
  }
  return formatName(id.name);
};
var isReservedTypeName = (name) => RESERVED_TYPE_NAMES.includes(name);
var prefixReservedTypeName = (name) => isReservedTypeName(name) ? `Resource${name}` : name;
var CSharp = class extends Writer {
  enums = {};
  constructor(options) {
    super({
      tabSize: 4,
      withDebugComment: false,
      commentLinePrefix: "//",
      resolveAssets: options.resolveAssets ?? resolveCSharpAssets,
      ...options
    });
  }
  async generate(typeSchemaIndex) {
    const complexTypes = typeSchemaIndex.collectComplexTypes();
    const resources = typeSchemaIndex.collectResources();
    const packages = Array.from(new Set(resources.map((r) => formatName(r.identifier.package))));
    this.generateAllFiles(complexTypes, resources, packages);
    this.copyStaticFiles();
  }
  generateAllFiles(complexTypes, resources, packages) {
    this.generateUsingFile(packages);
    this.generateBaseTypes(complexTypes);
    this.generateResources(resources);
    this.generateEnumFiles(packages);
    this.generateResourceDictionaries(resources, packages);
    this.generateHelperFile();
  }
  generateType(schema, packageName) {
    const className = formatClassName(schema);
    const baseClass = formatBaseClass(schema);
    this.curlyBlock(["public", "class", className, baseClass], () => {
      this.generateFields(schema, packageName);
      this.generateNestedTypes(schema, packageName);
      this.line();
      this.includeHelperMethods();
    });
    this.line();
  }
  generateFields(schema, packageName) {
    if (!schema.fields) return;
    const sortedFields = Object.entries(schema.fields).sort(([a], [b]) => a.localeCompare(b));
    for (const [fieldName, field] of sortedFields) {
      this.generateField(fieldName, field, packageName);
    }
  }
  generateNestedTypes(schema, packageName) {
    if (!("nested" in schema) || !schema.nested) return;
    this.line();
    for (const subtype of schema.nested) {
      this.generateType(subtype, packageName);
    }
  }
  generateField(fieldName, field, packageName) {
    try {
      if (isChoiceDeclarationField(field)) return;
      const fieldDeclaration = this.buildFieldDeclaration(fieldName, field, packageName);
      this.line(...fieldDeclaration);
    } catch (error) {
      this.logger()?.error(`Error processing field ${fieldName}: ${error.message}`);
    }
  }
  buildFieldDeclaration(fieldName, field, packageName) {
    const fieldType = this.determineFieldType(fieldName, field, packageName);
    const modifiers = getFieldModifiers(field);
    const propertyName = pascalCase(fieldName);
    const accessors = "{ get; set; }";
    return ["public", ...modifiers, fieldType, propertyName, accessors].filter(Boolean);
  }
  determineFieldType(fieldName, field, packageName) {
    let typeName = this.getBaseTypeName(field);
    if ("enum" in field && field.enum && !field.enum.isOpen) {
      typeName = this.registerAndGetEnumType(fieldName, field, packageName);
    }
    typeName = prefixReservedTypeName(typeName);
    const baseNamespacePrefix = "";
    const nullable = field.required ? "" : "?";
    const arraySpecifier = field.array ? "[]" : "";
    return `${baseNamespacePrefix}${typeName}${arraySpecifier}${nullable}`;
  }
  getBaseTypeName(field) {
    if ("type" in field) {
      let typeName = field.type.name.toString();
      if (field.type.kind === "nested") {
        typeName = getResourceName(field.type);
      } else if (field.type.kind === "primitive-type") typeName = PRIMITIVE_TYPE_MAP[field.type.name] ?? "string";
      return typeName;
    }
    return "";
  }
  registerAndGetEnumType(fieldName, field, packageName) {
    const enumName = formatName(field.binding?.name ?? fieldName);
    const enumTypeName = `${enumName}Enum`;
    if (!this.enums[packageName]) this.enums[packageName] = {};
    if (field.enum) this.enums[packageName][enumTypeName] = field.enum.values;
    return enumTypeName;
  }
  includeHelperMethods() {
    this.line("public override string ToString() => ");
    this.line("    JsonSerializer.Serialize(this, Helper.JsonSerializerOptions);");
    this.line();
  }
  generateUsingFile(packages) {
    this.cd("/", async () => {
      this.cat("Usings.cs", () => {
        this.generateDisclaimer();
        this.generateGlobalUsings(packages);
      });
    });
  }
  generateGlobalUsings(packages) {
    const globalUsings = [
      "CSharpSDK",
      "System.Text.Json",
      "System.Text.Json.Serialization",
      this.opts.rootNamespace,
      ...packages.map((pkg) => `${this.opts.rootNamespace}.${pkg}`)
    ];
    for (const using of globalUsings) this.lineSM("global", "using", using);
  }
  generateBaseTypes(complexTypes) {
    this.cd("/", async () => {
      this.cat("base.cs", () => {
        this.generateDisclaimer();
        this.line();
        this.lineSM("namespace", this.opts.rootNamespace);
        for (const schema of complexTypes) {
          const packageName = formatName(schema.identifier.package);
          this.generateType(schema, packageName);
        }
      });
    });
  }
  generateResources(resources) {
    for (const schema of resources) this.generateResourceFile(schema);
  }
  generateResourceFile(schema) {
    const packageName = formatName(schema.identifier.package);
    this.cd(`/${packageName}`, async () => {
      this.cat(`${schema.identifier.name}.cs`, () => {
        this.generateDisclaimer();
        this.line();
        this.lineSM("namespace", `${this.opts.rootNamespace}.${packageName}`);
        this.line();
        this.generateType(schema, packageName);
      });
    });
  }
  generateEnumFiles(packages) {
    for (const packageName of packages) {
      this.generatePackageEnums(packageName);
    }
  }
  generatePackageEnums(packageName) {
    const packageEnums = this.enums[packageName];
    if (!packageEnums || Object.keys(packageEnums).length === 0) return;
    this.cd(`/${packageName}`, async () => {
      this.cat(`${packageName}Enums.cs`, () => {
        this.generateDisclaimer();
        this.generateEnumFileContent(packageName, packageEnums);
      });
    });
  }
  generateEnumFileContent(packageName, enums) {
    this.lineSM("using", "System.ComponentModel");
    this.line();
    this.lineSM(`namespace ${this.opts.rootNamespace}.${packageName}`);
    for (const [enumName, values] of Object.entries(enums)) {
      this.generateEnum(enumName, values);
    }
  }
  generateEnum(enumName, values) {
    this.curlyBlock(["public", "enum", enumName], () => {
      for (const value of values) {
        this.line(`[Description("${value}")]`);
        this.line(`${formatEnumEntry(value)},`);
      }
    });
    this.line();
  }
  generateResourceDictionaries(resources, packages) {
    this.cd("/", async () => {
      for (const packageName of packages) {
        const packageResources = resources.filter((r) => formatName(r.identifier.package) === packageName);
        if (packageResources.length === 0) return;
        this.cat(`${packageName}ResourceDictionary.cs`, () => {
          this.generateDisclaimer();
          this.line();
          this.lineSM(`namespace ${this.opts.rootNamespace}`);
          this.generateResourceDictionaryClass(packageName, packageResources);
        });
      }
    });
  }
  generateResourceDictionaryClass(packageName, resources) {
    this.curlyBlock(["public", "static", "class", "ResourceDictionary"], () => {
      this.curlyBlock(["public static readonly Dictionary<Type, string> Map = new()"], () => {
        for (const schema of resources) {
          const typeName = schema.identifier.name;
          this.line(`{ typeof(${packageName}.${typeName}), "${typeName}" },`);
        }
      });
      this.lineSM();
    });
  }
  copyStaticFiles() {
    this.cp("Client.cs", "Client.cs");
    this.cp("Helper.cs", "Helper.cs");
  }
  generateHelperFile() {
    if (this.opts.inMemoryOnly) return;
    const sourceFile = resolveCSharpAssets("Helper.cs");
    const destFile = Path5__default.join(this.opts.outputDir, "Helper.cs");
    fs__default.copyFileSync(sourceFile, destFile);
  }
};

// src/api/writer-generator/python/naming-utils.ts
var PRIMITIVE_TYPE_MAP2 = {
  boolean: "bool",
  instant: "str",
  time: "str",
  date: "str",
  dateTime: "str",
  decimal: "float",
  integer: "int",
  unsignedInt: "int",
  positiveInt: "PositiveInt",
  integer64: "int",
  base64Binary: "str",
  uri: "str",
  url: "str",
  canonical: "str",
  oid: "str",
  uuid: "str",
  string: "str",
  code: "str",
  markdown: "str",
  id: "str",
  xhtml: "str"
};
var PYTHON_KEYWORDS = /* @__PURE__ */ new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield"
]);
var fixReservedWords = (name) => {
  return PYTHON_KEYWORDS.has(name) ? `${name}_` : name;
};
var canonicalToName2 = (canonical, dropFragment = true) => {
  if (!canonical) return void 0;
  let localName = canonical.split("/").pop();
  if (!localName) return void 0;
  if (dropFragment && localName.includes("#")) {
    localName = localName.split("#")[0];
  }
  if (!localName) return void 0;
  if (/^\d/.test(localName)) {
    localName = `number_${localName}`;
  }
  return snakeCase(localName);
};
var deriveResourceName = (id) => {
  if (id.kind === "nested") {
    const url = id.url;
    const path = canonicalToName2(url, false);
    if (!path) return "";
    const [resourceName, fragment] = path.split("#");
    const name = uppercaseFirstLetterOfEach((fragment ?? "").split(".")).join("");
    return pascalCase([resourceName, name].join(""));
  }
  return pascalCase(id.name);
};
var buildPyPackageName = (packageName) => {
  const parts = packageName ? [snakeCase(packageName)] : [""];
  return parts.join(".");
};
var pyFhirPackageByName = (rootPackageName, name) => [rootPackageName, buildPyPackageName(name)].join(".");
var pyFhirPackage = (rootPackageName, identifier) => pyFhirPackageByName(rootPackageName, identifier.package);
var pyPackage = (rootPackageName, identifier) => {
  if (identifier.kind === "complex-type") {
    return `${pyFhirPackage(rootPackageName, identifier)}.base`;
  }
  if (identifier.kind === "resource") {
    return [pyFhirPackage(rootPackageName, identifier), snakeCase(identifier.name)].join(".");
  }
  return pyFhirPackage(rootPackageName, identifier);
};
var pyTypeFromIdentifier = (id) => {
  if (isPrimitiveIdentifier(id)) return PRIMITIVE_TYPE_MAP2[id.name] ?? "str";
  const prim = PRIMITIVE_TYPE_MAP2[id.name];
  if (prim !== void 0) return prim;
  return deriveResourceName(id);
};
var groupByPackages = (typeSchemas) => {
  const grouped = {};
  for (const ts of typeSchemas) {
    const pkgName = ts.identifier.package;
    if (!grouped[pkgName]) grouped[pkgName] = [];
    grouped[pkgName].push(ts);
  }
  for (const [packageName, typeSchemas2] of Object.entries(grouped)) {
    const dict = {};
    for (const ts of typeSchemas2) {
      dict[JSON.stringify(ts.identifier)] = ts;
    }
    const tmp = Object.values(dict);
    tmp.sort((a, b) => a.identifier.name.localeCompare(b.identifier.name));
    grouped[packageName] = tmp;
  }
  return grouped;
};
var buildDependencyGraph = (schemas) => {
  const nameToMap = {};
  for (const schema of schemas) {
    nameToMap[schema.identifier.name] = schema;
  }
  const graph = {};
  for (const schema of schemas) {
    const name = schema.identifier.name;
    const base = schema.base?.name;
    if (!graph[name]) {
      graph[name] = [];
    }
    if (base && nameToMap[base]) {
      graph[name].push(base);
    }
  }
  return graph;
};
var topologicalSort = (graph) => {
  const sorted = [];
  const visited = {};
  const temp = {};
  const visit = (node) => {
    if (temp[node]) {
      throw new Error(`Graph has cycles ${node}`);
    }
    if (!visited[node]) {
      temp[node] = true;
      for (const neighbor of graph[node] ?? []) {
        visit(neighbor);
      }
      temp[node] = false;
      visited[node] = true;
      sorted.push(node);
    }
  };
  for (const node in graph) {
    if (!visited[node]) {
      visit(node);
    }
  }
  return sorted;
};
var sortAsDeclarationSequence = (schemas) => {
  const graph = buildDependencyGraph(schemas);
  const sorted = topologicalSort(graph);
  return sorted.map((name) => schemas.find((schema) => schema.identifier.name === name)).filter(Boolean);
};
var populateTypeFamily = (schemas) => {
  const directChildrenByParent = {};
  for (const schema of schemas) {
    if (!isSpecializationTypeSchema(schema) || !schema.base) continue;
    const parentUrl = schema.base.url;
    if (!directChildrenByParent[parentUrl]) directChildrenByParent[parentUrl] = [];
    directChildrenByParent[parentUrl].push(schema.identifier);
  }
  const transitiveCache = {};
  const getTransitiveChildren = (parentUrl) => {
    if (transitiveCache[parentUrl]) return transitiveCache[parentUrl];
    const direct = directChildrenByParent[parentUrl] ?? [];
    const result = [...direct];
    for (const child of direct) {
      result.push(...getTransitiveChildren(child.url));
    }
    transitiveCache[parentUrl] = result;
    return result;
  };
  for (const schema of schemas) {
    if (!isSpecializationTypeSchema(schema)) continue;
    const allChildren = getTransitiveChildren(schema.identifier.url);
    if (allChildren.length === 0) continue;
    const resources = allChildren.filter(isResourceIdentifier);
    const complexTypes = allChildren.filter(isComplexTypeIdentifier);
    const family = {};
    if (resources.length > 0) family.resources = resources;
    if (complexTypes.length > 0) family.complexTypes = complexTypes;
    if (Object.keys(family).length > 0) schema.typeFamily = family;
  }
};
var collectGenericContributions = (schema, resolveType) => {
  const contributions = [];
  for (const [fieldName, field] of Object.entries(schema.fields ?? {})) {
    if (isChoiceDeclarationField(field) || !field.type) continue;
    const target = resolveType(field.type);
    if (!target) continue;
    if (isNestedTypeSchema(target)) {
      const params = target.generic?.params;
      if (params?.length) contributions.push({ kind: "passthrough", fieldName, params });
    } else if (isSpecializationTypeSchema(target)) {
      const params = target.generic?.params;
      if (params?.length) {
        contributions.push({ kind: "passthrough", fieldName, params });
      } else if ((target.typeFamily?.resources?.length ?? 0) > 0) {
        contributions.push({ kind: "introduce", fieldName, constraint: field.type });
      }
    }
  }
  return contributions;
};
var samePath = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);
var leafOf = (path) => path[path.length - 1] ?? "";
var renderGenericParams = (contributions) => {
  const raw = [];
  for (const c of contributions) {
    if (c.kind === "introduce") {
      const path = [c.fieldName];
      if (!raw.find((r) => leafOf(r.path) === leafOf(path))) {
        raw.push({ path, constraint: c.constraint });
      }
    } else {
      for (const np of c.params) {
        const path = [c.fieldName, ...np.path];
        if (!raw.find((r) => leafOf(r.path) === leafOf(path))) {
          raw.push({ path, constraint: np.constraint });
        }
      }
    }
  }
  if (raw.length === 0) return [];
  return raw.map((r, i) => ({
    typeVar: raw.length === 1 ? "T" : `T${i + 1}`,
    constraint: r.constraint,
    path: r.path
  }));
};
var populateGeneric = (schemas, resolveType) => {
  const carriers = [];
  for (const schema of schemas) {
    if (isSpecializationTypeSchema(schema)) {
      carriers.push(schema);
      for (const nested of schema.nested ?? []) carriers.push(nested);
    } else if (isProfileTypeSchema(schema)) {
      for (const nested of schema.nested ?? []) carriers.push(nested);
    }
  }
  for (const c of carriers) c.generic = void 0;
  const sameParams = (a, b) => {
    if (a.length !== b.length) return false;
    for (const [i, x] of a.entries()) {
      const y = b[i];
      if (!y || x.typeVar !== y.typeVar || !samePath(x.path, y.path) || x.constraint.url !== y.constraint.url)
        return false;
    }
    return true;
  };
  let changed = true;
  let iter = 0;
  while (changed && iter++ <= carriers.length) {
    changed = false;
    for (const c of carriers) {
      const newParams = renderGenericParams(collectGenericContributions(c, resolveType));
      const oldParams = c.generic?.params ?? [];
      if (sameParams(oldParams, newParams)) continue;
      c.generic = newParams.length > 0 ? { params: newParams } : void 0;
      changed = true;
    }
  }
  for (const schema of schemas) {
    if (!isSpecializationTypeSchema(schema)) continue;
    const constraints = [];
    const collect = (params) => {
      for (const p of params) {
        if (!isNestedIdentifier(p.constraint)) constraints.push(p.constraint);
      }
    };
    if (schema.generic) collect(schema.generic.params);
    for (const nested of schema.nested ?? []) {
      if (nested.generic) collect(nested.generic.params);
    }
    if (constraints.length === 0) continue;
    schema.dependencies = concatIdentifiers(schema.dependencies, constraints) ?? schema.dependencies;
  }
};
var choiceInstances = (fields, declName) => Object.entries(fields).filter(
  (e) => isChoiceInstanceField(e[1]) && e[1].choiceOf === declName
);
var choiceUniverse = (fields, baseFields, declName, declField) => {
  const baseDecl = baseFields[declName];
  const baseChoices = isChoiceDeclarationField(baseDecl) ? baseDecl.choices : [];
  return [
    .../* @__PURE__ */ new Set([...baseChoices, ...declField.choices, ...choiceInstances(fields, declName).map(([name]) => name)])
  ];
};
var declaredChoiceVariants = (fields, declName) => {
  const declaration = fields[declName];
  const fromDeclaration = isChoiceDeclarationField(declaration) && !declaration.excluded ? declaration.choices : [];
  const fromInstances = choiceInstances(fields, declName).filter(([, field]) => !field.excluded).map(([name]) => name);
  return [.../* @__PURE__ */ new Set([...fromDeclaration, ...fromInstances])];
};
var resolvePermittedChoiceVariants = (universe, baseDeclaration, constraintSchemas, declName, logger) => {
  let permitted = new Set(isChoiceDeclarationField(baseDeclaration) ? baseDeclaration.choices : universe);
  for (const schema of constraintSchemas.slice().reverse()) {
    const fields = schema.fields;
    if (!fields) continue;
    const reintroduced = declaredChoiceVariants(fields, declName).filter((name) => !permitted.has(name));
    if (reintroduced.length > 0)
      logger?.dryWarn(
        "#nonMonotonicChoice",
        `Profile '${schema.identifier.name}' declares choice variant(s) ${reintroduced.join(", ")} of '${declName}' that an ancestor prohibits; they stay prohibited`
      );
    permitted = applyChoiceConstraints(permitted, fields, declName);
  }
  return permitted;
};
var applyChoiceConstraints = (permitted, fields, declName) => {
  const result = new Set(permitted);
  const instances = choiceInstances(fields, declName);
  for (const [name, field] of instances) {
    if (field.excluded) result.delete(name);
  }
  const declaration = fields[declName];
  if (isChoiceDeclarationField(declaration)) {
    if (declaration.excluded) return /* @__PURE__ */ new Set();
    const declared2 = new Set(declaration.choices);
    return new Set([...result].filter((name) => declared2.has(name)));
  }
  const declared = instances.filter(([, field]) => !field.excluded).map(([name]) => name);
  if (declared.length === 0) return result;
  const declaredSet = new Set(declared);
  return new Set([...result].filter((name) => declaredSet.has(name)));
};
var mkTypeSchemaIndex = (schemas, {
  register,
  logger,
  irReport = {}
}) => {
  const index = {};
  const nestedIndex = {};
  const snapshotIndex = {};
  const append = (schema) => {
    const url = schema.identifier.url;
    const pkg = schema.identifier.package;
    if (!index[url]) index[url] = {};
    if (index[url][pkg] && pkg !== "shared") {
      const r1 = JSON.stringify(schema.identifier, void 0, 2);
      const r2 = JSON.stringify(index[url][pkg]?.identifier, void 0, 2);
      if (r1 !== r2) throw new Error(`Duplicate schema: ${r1} and ${r2}`);
      return;
    }
    index[url][pkg] = schema;
    if (isSpecializationTypeSchema(schema) || isProfileTypeSchema(schema)) {
      if (schema.nested) {
        schema.nested.forEach((nschema) => {
          const nurl = nschema.identifier.url;
          const npkg = nschema.identifier.package;
          nestedIndex[nurl] ??= {};
          nestedIndex[nurl][npkg] = nschema;
        });
      }
    }
  };
  for (const schema of schemas) {
    append(schema);
  }
  populateTypeFamily(schemas);
  const resolve6 = ((id) => {
    if (isSnapshotProfileIdentifier(id)) return snapshotIndex[id.url]?.[id.package];
    return index[id.url]?.[id.package];
  });
  const resolveType = ((id) => {
    if (isNestedIdentifier(id)) return nestedIndex[id.url]?.[id.package];
    if (isSnapshotProfileIdentifier(id)) return snapshotIndex[id.url]?.[id.package];
    return index[id.url]?.[id.package];
  });
  populateGeneric(schemas, resolveType);
  const resolveByUrl = (pkgName, url) => {
    if (register) {
      const resolutionTree = register.resolutionTree();
      const resolution = resolutionTree[pkgName]?.[url]?.[0];
      if (resolution) {
        return index[url]?.[resolution.pkg.name];
      }
    }
    if (index[url]?.[pkgName]) return index[url]?.[pkgName];
    if (nestedIndex[url]?.[pkgName]) return nestedIndex[url]?.[pkgName];
    logger?.dryWarn(`Type '${url}' not found in '${pkgName}'`);
    if (index[url]) {
      const anyPkg = Object.keys(index[url])[0];
      if (anyPkg) {
        logger?.dryWarn(`Type '${url}' fallback to package ${anyPkg}`);
        return index[url]?.[anyPkg];
      }
    }
    if (nestedIndex[url]) {
      const anyPkg = Object.keys(nestedIndex[url])[0];
      if (anyPkg) {
        logger?.dryWarn(`Type '${url}' fallback to package ${anyPkg}`);
        return nestedIndex[url]?.[anyPkg];
      }
    }
    return void 0;
  };
  const tryHierarchy = (schema) => {
    const res = [];
    let cur = schema;
    while (cur) {
      res.push(cur);
      const base = cur.base;
      if (base === void 0) break;
      if (isNestedIdentifier(base)) break;
      const resolved = resolve6(base);
      if (!resolved) {
        logger?.warn(
          "#resolveBase",
          `Failed to resolve base type: ${res.map((e) => `${e.identifier.url} (${e.identifier.kind})`).join(", ")}`
        );
        return void 0;
      }
      cur = resolved;
    }
    return res;
  };
  const hierarchy = (schema) => {
    const genealogy = tryHierarchy(schema);
    if (genealogy === void 0) {
      throw new Error(`Failed to resolve base type: ${schema.identifier.url} (${schema.identifier.kind})`);
    }
    return genealogy;
  };
  const findLastSpecialization = (schema) => {
    const nonConstraintSchema = hierarchy(schema).find(
      (s) => !isProfileTypeSchema(s) && !isSnapshotProfileTypeSchema(s)
    );
    if (!nonConstraintSchema) {
      throw new Error(`No non-constraint schema found in hierarchy for: ${schema.identifier.name}`);
    }
    return nonConstraintSchema;
  };
  const findLastSpecializationByIdentifier = (id) => {
    const resolved = resolveType(id);
    if (!resolved) return id;
    if (isNestedTypeSchema(resolved)) return findLastSpecializationByIdentifier(resolved.base);
    return findLastSpecialization(resolved).identifier;
  };
  const narrowMergedChoiceDeclarations = (mergedFields, constraintSchemas, baseFields = {}) => {
    const result = { ...mergedFields };
    const declNames = /* @__PURE__ */ new Set([...Object.keys(result), ...Object.keys(baseFields)]);
    for (const declName of declNames) {
      const declField = result[declName] ?? baseFields[declName];
      if (!isChoiceDeclarationField(declField)) continue;
      const restated = result[declName] !== void 0;
      if (!restated && choiceInstances(result, declName).length === 0) continue;
      const universe = choiceUniverse(result, baseFields, declName, declField);
      const permitted = resolvePermittedChoiceVariants(
        universe,
        baseFields[declName],
        constraintSchemas,
        declName,
        logger
      );
      const prohibited = universe.filter((name) => !permitted.has(name));
      if (!restated && prohibited.length === 0) continue;
      result[declName] = {
        ...declField,
        choices: universe.filter((name) => permitted.has(name)),
        ...prohibited.length > 0 ? { prohibited } : {}
      };
    }
    return result;
  };
  const flatProfile = (schema) => {
    const hierarchySchemas = hierarchy(schema);
    const constraintSchemas = hierarchySchemas.filter((s) => s.identifier.kind === "profile");
    const nonConstraintSchema = hierarchySchemas.find((s) => s.identifier.kind !== "profile");
    if (!nonConstraintSchema)
      throw new Error(`No non-constraint schema found in hierarchy for ${schema.identifier.name}`);
    const mergedFields = {};
    for (const anySchema of constraintSchemas.slice().reverse()) {
      const schema2 = anySchema;
      if (!schema2.fields) continue;
      for (const [fieldName, fieldConstraints] of Object.entries(schema2.fields)) {
        const merged = mergedFields[fieldName] ? { ...mergedFields[fieldName], ...fieldConstraints } : { ...fieldConstraints };
        if ("min" in fieldConstraints && fieldConstraints.min === 0) {
          merged.required = false;
        }
        mergedFields[fieldName] = merged;
      }
    }
    const narrowedFields = narrowMergedChoiceDeclarations(
      mergedFields,
      constraintSchemas,
      nonConstraintSchema.fields
    );
    const dependencies = Object.values(
      Object.fromEntries(
        constraintSchemas.flatMap((s) => s.dependencies ?? []).map((dep) => [dep.url, dep])
      )
    );
    const mergedExtensions = Object.values(
      [...constraintSchemas.filter(isProfileTypeSchema)].reverse().flatMap((s) => s.extensions ?? []).reduce((acc, ext) => {
        const key = `${ext.path}|${ext.name}`;
        if (!acc[key] || ext.url?.includes("/")) acc[key] = ext;
        return acc;
      }, {})
    );
    return {
      ...schema,
      base: nonConstraintSchema.identifier,
      fields: narrowedFields,
      dependencies,
      extensions: mergedExtensions.length > 0 ? mergedExtensions : void 0
    };
  };
  const buildProfileSnapshot = (schema) => {
    const flat = flatProfile(schema);
    const flatFields = flat.fields ?? {};
    const hierarchySchemas = hierarchy(schema);
    const nonConstraintSchema = hierarchySchemas.find((s) => s.identifier.kind !== "profile");
    const inheritedRequiredFields = [];
    if (nonConstraintSchema?.fields) {
      for (const [name, baseField] of Object.entries(nonConstraintSchema.fields)) {
        if (!baseField.required) continue;
        if (isChoiceDeclarationField(baseField)) continue;
        const flat2 = flatFields[name];
        if (flat2?.min === 0) continue;
        if (flat2?.required) continue;
        inheritedRequiredFields.push(name);
      }
    }
    return {
      identifier: snapshotIdentifier(flat.identifier),
      base: flat.base,
      description: flat.description,
      fields: flatFields,
      inheritedRequiredFields: inheritedRequiredFields.length > 0 ? inheritedRequiredFields : void 0,
      extensions: flat.extensions,
      dependencies: flat.dependencies,
      nested: flat.nested
    };
  };
  for (const schema of schemas) {
    if (!isProfileTypeSchema(schema)) continue;
    const hier = tryHierarchy(schema);
    if (!hier?.some((s) => !isProfileTypeSchema(s) && !isSnapshotProfileTypeSchema(s))) continue;
    const snap = buildProfileSnapshot(schema);
    const byPkg = snapshotIndex[snap.identifier.url] ??= {};
    byPkg[snap.identifier.package] = snap;
  }
  const collectSnapshotProfiles = () => Object.values(snapshotIndex).flatMap((byPkg) => Object.values(byPkg));
  const constrainedChoice = (pkgName, baseTypeId, sliceElements) => {
    const baseSchema = resolveByUrl(pkgName, baseTypeId.url);
    if (!baseSchema || !("fields" in baseSchema) || !baseSchema.fields) return void 0;
    for (const [fieldName, field] of Object.entries(baseSchema.fields)) {
      if (!isChoiceDeclarationField(field)) continue;
      const matchingVariants = field.choices.filter((c) => sliceElements.includes(c));
      if (matchingVariants.length !== 1) continue;
      const variantName = matchingVariants[0];
      const variantField = baseSchema.fields[variantName];
      if (!variantField || !isChoiceInstanceField(variantField)) continue;
      return {
        choiceBase: fieldName,
        variant: variantName,
        variantType: variantField.type,
        allChoiceNames: field.choices
      };
    }
    return void 0;
  };
  const isWithMetaField = (profile) => {
    const genealogy = tryHierarchy(profile);
    if (!genealogy) return false;
    return genealogy.filter(isSpecializationTypeSchema).some((schema) => {
      return schema.fields?.meta !== void 0;
    });
  };
  const entityTree = () => {
    const tree = {};
    for (const [pkgId, shemas] of Object.entries(groupByPackages(schemas))) {
      tree[pkgId] = {
        "primitive-type": {},
        "complex-type": {},
        resource: {},
        "value-set": {},
        nested: {},
        binding: {},
        profile: {},
        "profile-snapshot": {},
        logical: {}
      };
      for (const schema of shemas) {
        tree[pkgId][schema.identifier.kind][schema.identifier.url] = {};
      }
    }
    return tree;
  };
  const exportTree = async (filename) => {
    const tree = entityTree();
    const raw = filename.endsWith(".yaml") ? YAML.stringify(tree) : JSON.stringify(tree, void 0, 2);
    await fsPromises.mkdir(Path5.dirname(filename), { recursive: true });
    await fsPromises.writeFile(filename, raw);
  };
  return {
    _schemaIndex: index,
    schemas,
    schemasByPackage: groupByPackages(schemas),
    register,
    collectComplexTypes: () => schemas.filter(isComplexTypeTypeSchema),
    collectResources: () => schemas.filter(isResourceTypeSchema),
    collectLogicalModels: () => schemas.filter(isLogicalTypeSchema),
    collectProfiles: () => schemas.filter(isProfileTypeSchema),
    collectSnapshotProfiles,
    resolve: resolve6,
    resolveType,
    resolveByUrl,
    tryHierarchy,
    hierarchy,
    findLastSpecialization,
    findLastSpecializationByIdentifier,
    flatProfile,
    constrainedChoice,
    isWithMetaField,
    entityTree,
    exportTree,
    irReport: () => irReport,
    replaceSchemas: (newSchemas) => mkTypeSchemaIndex(newSchemas, { register, logger, irReport: { ...irReport } })
  };
};

// src/api/writer-generator/python/profile-naming.ts
var normalizePyName = (n) => {
  let out = n.replace(/\[x\]/g, "_x_").replace(/[- :./]/g, "_");
  if (PYTHON_KEYWORDS.has(out)) out = `${out}_`;
  if (/^\d/.test(out)) out = `_${out}`;
  return out;
};
var pySnakeName = (name) => {
  if (!name) return "";
  const cleaned = name.replace(/\[x\]/g, "").replace(/[:./]/g, "_");
  return snakeCase(cleaned);
};
var pyFieldName = (n, formatName2 = snakeCase) => {
  const cleaned = n.replace(/\[x\]/g, "").replace(/[:./]/g, "_");
  const out = formatName2(cleaned);
  return PYTHON_KEYWORDS.has(out) ? `${out}_` : out;
};
var pyProfileClassName = (schema) => {
  const name = pascalCase(normalizePyName(schema.identifier.name));
  if (schema.base.name === "Extension") {
    return name.endsWith("Extension") ? name : `${name}Extension`;
  }
  return name.endsWith("Profile") ? name : `${name}Profile`;
};
var pyProfileModuleName = (tsIndex, schema) => {
  const baseSchema = tsIndex.findLastSpecialization(schema);
  const baseName = snakeCase(normalizePyName(baseSchema.identifier.name));
  const profileName = snakeCase(normalizePyName(schema.identifier.name));
  return `${baseName}_${profileName}`;
};
var pySliceStaticName = (name) => {
  const cleaned = name.replace(/\[x]/g, "").replace(/[^a-zA-Z0-9_]/g, "_");
  return `_${snakeCase(cleaned)}_slice_match`;
};
var pyValueFieldName = (id, formatName2 = snakeCase) => formatName2(`value${pascalCase(normalizePyName(id.name))}`);
var resolveProfileMethodBaseNames = (extensions, sliceDefs) => {
  const extensionsRecord = {};
  for (const ext of extensions) {
    if (!ext.url) continue;
    extensionsRecord[`${ext.url}:${ext.path}`] = snakeCase(ext.nameCandidates.recommended);
  }
  const slicesRecord = {};
  for (const s of sliceDefs) {
    slicesRecord[`${s.fieldName}:${s.sliceName}`] = snakeCase(s.nameCandidates.recommended);
  }
  const allBaseNames = /* @__PURE__ */ new Set([...Object.values(extensionsRecord), ...Object.values(slicesRecord)]);
  return { extensions: extensionsRecord, slices: slicesRecord, allBaseNames };
};

// src/api/writer-generator/python/profile-extensions.ts
var resolveExtensionProfile = (tsIndex, pkgName, ext) => {
  if (ext.profile) {
    const schema2 = tsIndex.resolve(ext.profile);
    if (schema2) {
      return {
        className: pyProfileClassName(schema2),
        moduleName: pyProfileModuleName(tsIndex, schema2)
      };
    }
  }
  if (!ext.url) return void 0;
  const schema = tsIndex.resolveByUrl(pkgName, ext.url);
  if (!schema || !isProfileTypeSchema(schema)) return void 0;
  if (schema.identifier.package !== pkgName) return void 0;
  return {
    className: pyProfileClassName(schema),
    moduleName: pyProfileModuleName(tsIndex, schema)
  };
};
var generateExtensionMethods = (w, tsIndex, flatProfile, className, extensionBaseNames) => {
  const pkgName = flatProfile.identifier.package;
  for (const ext of flatProfile.extensions ?? []) {
    if (!ext.url) continue;
    const baseName = extensionBaseNames[`${ext.url}:${ext.path}`] ?? snakeCase(ext.nameCandidates.recommended);
    const targetPath = ext.path.split(".").filter((segment) => segment !== "extension");
    const extProfileInfo = resolveExtensionProfile(tsIndex, pkgName, ext);
    if (ext.isComplex && ext.subExtensions) {
      generateComplexExtensionGetter(w, ext, baseName, targetPath, extProfileInfo);
      generateComplexExtensionSetter(w, ext, className, baseName, targetPath, extProfileInfo);
    } else if (ext.valueFieldTypes?.length === 1 && ext.valueFieldTypes[0]) {
      const valueType = ext.valueFieldTypes[0];
      const valueField = pyValueFieldName(valueType, w.nameFormatFunction);
      const pyType = pyTypeFromIdentifier(valueType);
      generateSingleValueExtensionGetter(w, ext, baseName, targetPath, valueField, pyType, extProfileInfo);
      generateSingleValueExtensionSetter(
        w,
        ext,
        className,
        baseName,
        targetPath,
        valueField,
        pyType,
        extProfileInfo
      );
    } else {
      generateGenericExtensionGetter(w, ext, baseName, targetPath, extProfileInfo);
      generateGenericExtensionSetter(w, ext, className, baseName, targetPath, extProfileInfo);
    }
  }
};
var emitExtLookup = (w, ext, targetPath) => {
  if (targetPath.length === 0) {
    w.line(`exts = getattr(self._resource, "extension", None) or []`);
  } else {
    w.line(
      `target = ensure_path(self._resource.model_dump(by_alias=True, exclude_none=True) if hasattr(self._resource, "model_dump") else self._resource, ${JSON.stringify(targetPath)})`
    );
    w.line(`exts = target.get("extension", []) if isinstance(target, dict) else []`);
  }
  w.line(`ext = next((e for e in exts if is_extension(e, ${JSON.stringify(ext.url)})), None)`);
};
var emitExtPush = (w, targetPath, extExpr) => {
  if (targetPath.length === 0) {
    w.line(`push_extension(self._resource, ${extExpr})`);
  } else {
    w.line(`target = ensure_path(self._resource, ${JSON.stringify(targetPath)})`);
    w.line(`push_extension(target, ${extExpr})`);
  }
};
var emitGetterOverloads = (w, methodName, flatPyType, extProfileInfo) => {
  const profileClass = extProfileInfo?.className;
  w.line("@overload");
  w.line(`def ${methodName}(self) -> ${flatPyType} | None: ...`);
  w.line("@overload");
  w.line(`def ${methodName}(self, mode: Literal["raw"]) -> Extension | None: ...`);
  if (profileClass) {
    w.line("@overload");
    w.line(`def ${methodName}(self, mode: Literal["profile"]) -> ${profileClass} | None: ...`);
  }
  const modeType = profileClass ? `Literal["raw", "profile"] | None` : `Literal["raw"] | None`;
  const returnUnion = profileClass ? `${flatPyType} | Extension | ${profileClass} | None` : `${flatPyType} | Extension | None`;
  w.line(`def ${methodName}(self, mode: ${modeType} = None) -> ${returnUnion}:`);
};
var emitGetterModeDispatch = (w, extProfileInfo) => {
  w.line("ext_obj = ext if not isinstance(ext, dict) else Extension(**ext)");
  w.line(`if mode == "raw":`);
  w.indentBlock(() => w.line("return ext_obj"));
  if (extProfileInfo) {
    w.line(`if mode == "profile":`);
    w.indentBlock(() => w.line(`return ${extProfileInfo.className}.apply(ext_obj)`));
  }
};
var emitSetterDispatchPreamble = (w, ext, targetPath, extProfileInfo) => {
  let startedChain = false;
  if (extProfileInfo) {
    w.line(`if isinstance(value, ${extProfileInfo.className}):`);
    w.indentBlock(() => emitExtPush(w, targetPath, "value.to_resource()"));
    startedChain = true;
  }
  const keyword = startedChain ? "elif" : "if";
  w.line(`${keyword} is_extension(value):`);
  w.indentBlock(() => {
    w.line(`if _get_key(value, "url") != ${JSON.stringify(ext.url)}:`);
    w.indentBlock(
      () => w.line(`raise ValueError(f"Expected extension url '${ext.url}', got {_get_key(value, 'url')!r}")`)
    );
    emitExtPush(w, targetPath, "value");
  });
};
var buildSetterParamType = (flatType, extProfileInfo) => {
  const parts = [];
  if (extProfileInfo) parts.push(extProfileInfo.className);
  parts.push("Extension", flatType);
  return `"${parts.join(" | ")}"`;
};
var generateExtensionGetter = (w, ext, baseName, flatPyType, targetPath, extProfileInfo, emitFlatReturn) => {
  emitGetterOverloads(w, `get_${baseName}`, flatPyType, extProfileInfo);
  w.indentBlock(() => {
    emitExtLookup(w, ext, targetPath);
    w.line("if ext is None:");
    w.indentBlock(() => w.line("return None"));
    emitGetterModeDispatch(w, extProfileInfo);
    emitFlatReturn();
  });
  w.line();
};
var generateComplexExtensionGetter = (w, ext, baseName, targetPath, extProfileInfo) => {
  generateExtensionGetter(w, ext, baseName, "dict[str, Any]", targetPath, extProfileInfo, () => {
    const configItems = (ext.subExtensions ?? []).map((sub) => {
      const valueField = sub.valueFieldType ? pyValueFieldName(sub.valueFieldType, w.nameFormatFunction) : "value";
      const isArray = sub.max === "*";
      return `{"name": ${JSON.stringify(sub.url)}, "valueField": ${JSON.stringify(valueField)}, "isArray": ${isArray ? "True" : "False"}}`;
    });
    w.line(`config = [${configItems.join(", ")}]`);
    w.line("return extract_complex_extension(ext, config)");
  });
};
var generateExtensionSetter = (w, ext, className, baseName, flatParamType, targetPath, extProfileInfo, emitElseBody) => {
  const paramType = buildSetterParamType(flatParamType, extProfileInfo);
  w.line(`def set_${baseName}(self, value: ${paramType}) -> "${className}":`);
  w.indentBlock(() => {
    emitSetterDispatchPreamble(w, ext, targetPath, extProfileInfo);
    w.line("else:");
    w.indentBlock(emitElseBody);
    w.line("return self");
  });
  w.line();
};
var generateComplexExtensionSetter = (w, ext, className, baseName, targetPath, extProfileInfo) => {
  generateExtensionSetter(w, ext, className, baseName, "dict[str, Any]", targetPath, extProfileInfo, () => {
    w.line("assert is_record(value)");
    w.line("sub_extensions = []");
    for (const sub of ext.subExtensions ?? []) {
      const valueField = sub.valueFieldType ? pyValueFieldName(sub.valueFieldType, w.nameFormatFunction) : "value";
      if (sub.max === "*") {
        w.line(`for item in value.get(${JSON.stringify(sub.url)}, []):`);
        w.indentBlock(() => {
          w.line(
            `sub_extensions.append({"url": ${JSON.stringify(sub.url)}, ${JSON.stringify(valueField)}: item})`
          );
        });
      } else {
        w.line(`if value.get(${JSON.stringify(sub.url)}) is not None:`);
        w.indentBlock(() => {
          w.line(
            `sub_extensions.append({"url": ${JSON.stringify(sub.url)}, ${JSON.stringify(valueField)}: value[${JSON.stringify(sub.url)}]})`
          );
        });
      }
    }
    const extObj = `Extension(url=${JSON.stringify(ext.url)}, extension=sub_extensions)`;
    emitExtPush(w, targetPath, extObj);
  });
};
var generateSingleValueExtensionGetter = (w, ext, baseName, targetPath, valueField, pyType, extProfileInfo) => {
  generateExtensionGetter(w, ext, baseName, pyType, targetPath, extProfileInfo, () => {
    w.line(`return cast('${pyType} | None', get_extension_value(ext, ${JSON.stringify(valueField)}))`);
  });
};
var generateSingleValueExtensionSetter = (w, ext, className, baseName, targetPath, valueField, pyType, extProfileInfo) => {
  generateExtensionSetter(w, ext, className, baseName, pyType, targetPath, extProfileInfo, () => {
    w.line("assert not isinstance(value, Extension)");
    emitExtPush(w, targetPath, `Extension(url=${JSON.stringify(ext.url)}, ${valueField}=value)`);
  });
};
var generateGenericExtensionGetter = (w, ext, baseName, targetPath, extProfileInfo) => {
  generateExtensionGetter(w, ext, baseName, "dict[str, Any]", targetPath, extProfileInfo, () => {
    w.line(
      'return cast("dict[str, Any] | None", ext if isinstance(ext, dict) else ext.model_dump(by_alias=True, exclude_none=True))'
    );
  });
};
var generateGenericExtensionSetter = (w, ext, className, baseName, targetPath, extProfileInfo) => {
  generateExtensionSetter(w, ext, className, baseName, "dict[str, Any]", targetPath, extProfileInfo, () => {
    w.line("assert is_record(value)");
    emitExtPush(w, targetPath, `{"url": ${JSON.stringify(ext.url)}, **value}`);
  });
};

// src/api/writer-generator/python/profile-slices.ts
var collectRequiredSliceNames = (field) => {
  if (!field.array || !field.slicing?.slices) return void 0;
  if (field.slicing.discriminator?.some((d) => d.type === "type")) return void 0;
  const names = Object.entries(field.slicing.slices).filter(([_, s]) => s.min !== void 0 && s.min >= 1 && s.match && Object.keys(s.match).length > 0).map(([name]) => name);
  return names.length > 0 ? names : void 0;
};
var generateStaticSliceFields = (w, sliceDefs) => {
  for (const sliceDef of sliceDefs) {
    const staticName = pySliceStaticName(sliceDef.sliceName);
    w.line(`${staticName}: dict[str, Any] = ${JSON.stringify(sliceDef.match)}`);
  }
  if (sliceDefs.length > 0) w.line();
};
var normalizeMatchForPython = (tsIndex, match, schema) => {
  if (!schema || !("fields" in schema) || !schema.fields) return match;
  const result = {};
  for (const [key, value] of Object.entries(match)) {
    const fieldDef = schema.fields[key];
    if (!fieldDef || !isNotChoiceDeclarationField(fieldDef)) {
      result[key] = value;
      continue;
    }
    const nestedSchema = fieldDef.type ? tsIndex.resolveType(fieldDef.type) : void 0;
    const normalizeOne = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? normalizeMatchForPython(tsIndex, v, nestedSchema) : v;
    if (Array.isArray(value)) {
      result[key] = value.map(normalizeOne);
    } else if (value !== null && typeof value === "object") {
      const normalized = normalizeOne(value);
      result[key] = fieldDef.array ? [normalized] : normalized;
    } else {
      result[key] = value;
    }
  }
  return result;
};
var extractTypeDiscriminatorResource = (isTypeDiscriminated, rawMatch) => {
  if (!isTypeDiscriminated || !rawMatch) return void 0;
  for (const val of Object.values(rawMatch)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const rt = val.resourceType;
      if (typeof rt === "string") return rt;
    }
  }
  return void 0;
};
var collectSliceDefs = (tsIndex, flatProfile) => {
  const pkgName = flatProfile.identifier.package;
  return Object.entries(flatProfile.fields).flatMap(([fieldName, field]) => {
    if (!isNotChoiceDeclarationField(field) || !field.slicing?.slices || !field.type) return [];
    const choiceBaseNames = /* @__PURE__ */ new Set();
    const baseSchema = tsIndex.resolveType(field.type);
    if (baseSchema && "fields" in baseSchema && baseSchema.fields) {
      for (const [n, f] of Object.entries(baseSchema.fields)) {
        if (isChoiceDeclarationField(f)) choiceBaseNames.add(n);
      }
    }
    return Object.entries(field.slicing.slices).filter(([_, slice]) => Object.keys(slice.match ?? {}).length > 0).map(([sliceName, slice]) => {
      const matchFields = Object.keys(slice.match ?? {});
      const required = (slice.required ?? []).filter(
        (name) => !matchFields.includes(name) && !choiceBaseNames.has(name)
      );
      const cc = slice.elements ? tsIndex.constrainedChoice(pkgName, field.type, slice.elements) : void 0;
      const constrainedChoice = cc && !isPrimitiveIdentifier(cc.variantType) ? cc : void 0;
      const isTypeDiscriminated = field.slicing?.discriminator?.some((d) => d.type === "type") ?? false;
      const typeDiscriminatorResource = extractTypeDiscriminatorResource(
        isTypeDiscriminated,
        slice.match
      );
      return {
        fieldName,
        sliceName,
        match: normalizeMatchForPython(tsIndex, slice.match ?? {}, baseSchema),
        required,
        array: Boolean(field.array),
        max: slice.max ?? 0,
        constrainedChoice,
        elementTypeName: field.type && !isPrimitiveIdentifier(field.type) ? pyTypeFromIdentifier(field.type) : void 0,
        elementTypeId: field.type && !isPrimitiveIdentifier(field.type) ? field.type : void 0,
        isTypeDiscriminated,
        typeDiscriminatorResource,
        nameCandidates: slice.nameCandidates
      };
    });
  });
};
var sliceElementRetType = (sliceDef) => sliceDef.elementTypeName && sliceDef.typeDiscriminatorResource ? `${sliceDef.elementTypeName}[${sliceDef.typeDiscriminatorResource}]` : sliceDef.elementTypeName ?? "Any";
var generateSliceGetters = (w, sliceDefs, sliceBaseNames) => {
  for (const sliceDef of sliceDefs) {
    const baseName = sliceBaseNames[`${sliceDef.fieldName}:${sliceDef.sliceName}`] ?? sliceDef.nameCandidates.recommended;
    const staticName = pySliceStaticName(sliceDef.sliceName);
    const fieldName = pyFieldName(sliceDef.fieldName, w.nameFormatFunction);
    const matchKeys = JSON.stringify(Object.keys(sliceDef.match));
    if (sliceDef.isTypeDiscriminated) {
      const retType = sliceElementRetType(sliceDef);
      const isUnbounded = sliceDef.array && sliceDef.max === 0;
      if (isUnbounded) {
        w.line(`def get_${baseName}(self, mode: str | None = None) -> list[${retType}] | None:`);
        w.indentBlock(() => {
          w.line(`match = self.__class__.${staticName}`);
          w.line(
            `result = get_array_slices(getattr(self._resource, ${JSON.stringify(fieldName)}, None), match)`
          );
          w.line(`return cast('list[${retType}] | None', result or None)`);
        });
      } else {
        w.line(`def get_${baseName}(self, mode: str | None = None) -> ${retType} | None:`);
        w.indentBlock(() => {
          w.line(`match = self.__class__.${staticName}`);
          w.line(
            `return cast('${retType} | None', get_array_slice(getattr(self._resource, ${JSON.stringify(fieldName)}, None), match))`
          );
        });
      }
    } else {
      const flatRetType = "dict[str, Any]";
      const rawRetType = sliceDef.elementTypeName ?? "Any";
      w.line("@overload");
      w.line(`def get_${baseName}(self) -> ${flatRetType} | None: ...`);
      w.line("@overload");
      w.line(`def get_${baseName}(self, mode: Literal["raw"]) -> ${rawRetType} | None: ...`);
      w.line(
        `def get_${baseName}(self, mode: Literal["raw"] | None = None) -> ${flatRetType} | ${rawRetType} | None:`
      );
      w.indentBlock(() => {
        w.line(`match = self.__class__.${staticName}`);
        if (sliceDef.array) {
          w.line(
            `item = get_array_slice(getattr(self._resource, ${JSON.stringify(fieldName)}, None), match)`
          );
        } else {
          w.line(`item = getattr(self._resource, ${JSON.stringify(fieldName)}, None)`);
          w.line("if item is None or not matches_value(item, match):");
          w.indentBlock(() => {
            w.line("return None");
          });
        }
        w.line('if mode == "raw":');
        w.indentBlock(() => {
          w.line(`return cast('${rawRetType} | None', item)`);
        });
        w.line(
          "item_dict = item if isinstance(item, dict) else item.model_dump(by_alias=True, exclude_none=True)"
        );
        if (sliceDef.constrainedChoice) {
          const variant = JSON.stringify(sliceDef.constrainedChoice.variant);
          w.line(`return unwrap_slice_choice(item_dict, ${matchKeys}, ${variant})`);
        } else {
          w.line(`return strip_match_keys(item_dict, ${matchKeys})`);
        }
      });
    }
    w.line();
  }
};
var generateSliceSetters = (w, className, sliceDefs, sliceBaseNames) => {
  for (const sliceDef of sliceDefs) {
    const baseName = sliceBaseNames[`${sliceDef.fieldName}:${sliceDef.sliceName}`] ?? sliceDef.nameCandidates.recommended;
    const staticName = pySliceStaticName(sliceDef.sliceName);
    const fieldName = pyFieldName(sliceDef.fieldName, w.nameFormatFunction);
    if (sliceDef.isTypeDiscriminated) {
      const retType = sliceElementRetType(sliceDef);
      const isUnbounded = sliceDef.array && sliceDef.max === 0;
      if (isUnbounded) {
        w.line(`def set_${baseName}(self, values: list[${retType}]) -> "${className}":`);
        w.indentBlock(() => {
          w.line(`match = self.__class__.${staticName}`);
          w.line(`items = list(getattr(self._resource, ${JSON.stringify(fieldName)}, None) or [])`);
          w.line("set_array_slices(items, match, values)");
          w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, items)`);
          w.line("return self");
        });
      } else {
        w.line(`def set_${baseName}(self, value: ${retType} | None = None) -> "${className}":`);
        w.indentBlock(() => {
          w.line(`match = self.__class__.${staticName}`);
          w.line(`items = getattr(self._resource, ${JSON.stringify(fieldName)}, None) or []`);
          w.line("set_array_slice(items, match, value)");
          w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, items)`);
          w.line("return self");
        });
      }
    } else {
      const inputOptional = sliceDef.required.length === 0;
      const sig = inputOptional ? `def set_${baseName}(self, value: dict[str, Any] | None = None) -> "${className}":` : `def set_${baseName}(self, value: dict[str, Any]) -> "${className}":`;
      w.line(sig);
      w.indentBlock(() => {
        w.line(`match = self.__class__.${staticName}`);
        const inputExpr = inputOptional ? "(value or {})" : "value";
        if (sliceDef.constrainedChoice) {
          const variant = JSON.stringify(sliceDef.constrainedChoice.variant);
          w.line(`wrapped = wrap_slice_choice(${inputExpr}, ${variant})`);
          w.line("merged = apply_slice_match(wrapped, match)");
        } else {
          w.line(`merged = apply_slice_match(${inputExpr}, match)`);
        }
        let elementExpr = "merged";
        if (sliceDef.elementTypeName) {
          w.line(`element = ${sliceDef.elementTypeName}(**merged)`);
          elementExpr = "element";
        }
        if (sliceDef.array) {
          w.line(`items = getattr(self._resource, ${JSON.stringify(fieldName)}, None) or []`);
          w.line(`set_array_slice(items, match, ${elementExpr})`);
          w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, items)`);
        } else {
          w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, ${elementExpr})`);
        }
        w.line("return self");
      });
    }
    w.line();
  }
};

// src/api/writer-generator/python/profile-factory.ts
var fieldPyType = (field, resolveRef) => {
  const resolved = resolveRef ? resolveRef(field.type) : field.type;
  const base = pyTypeFromIdentifier(resolved);
  if (base === "str" && field.enum && !field.enum.isOpen && field.enum.values.length > 0) {
    const literal = `Literal[${field.enum.values.map((v) => JSON.stringify(v)).join(", ")}]`;
    return field.array ? `list[${literal}]` : literal;
  }
  return field.array ? `list[${base}]` : base;
};
var tryPromoteChoice = (field, fields, params, promotedChoices) => {
  if (!isChoiceDeclarationField(field) || !field.required || field.choices.length !== 1) return;
  const choiceName = field.choices[0];
  if (!choiceName) return;
  const choiceField = fields[choiceName];
  if (!choiceField || !isChoiceInstanceField(choiceField)) return;
  const pyType = pyTypeFromIdentifier(choiceField.type) + (choiceField.array ? "[]" : "");
  params.push({ name: choiceName, pyType, typeId: choiceField.type });
  promotedChoices.add(choiceName);
};
var collectBaseRequiredParams = (tsIndex, flatProfile, resolveRef, params, coveredNames) => {
  const covered = new Set(coveredNames);
  const baseSchema = tsIndex.resolveType(flatProfile.base);
  if (!baseSchema || !("fields" in baseSchema) || !baseSchema.fields) return;
  for (const [name, field] of Object.entries(baseSchema.fields)) {
    if (covered.has(name)) continue;
    if (!field.required) continue;
    if (isChoiceInstanceField(field)) continue;
    if (isChoiceDeclarationField(field)) continue;
    if (isNotChoiceDeclarationField(field) && field.type) {
      const pyType = fieldPyType(field, resolveRef);
      params.push({ name, pyType, typeId: field.type });
    }
  }
};
var collectProfileFactoryInfo = (tsIndex, flatProfile) => {
  const autoFields = [];
  const sliceAutoFields = [];
  const params = [];
  const autoAccessors = [];
  const pendingChoiceInstances = [];
  const fields = flatProfile.fields;
  const promotedChoices = /* @__PURE__ */ new Set();
  const resolveRef = tsIndex.findLastSpecializationByIdentifier;
  const choiceGroups = /* @__PURE__ */ new Map();
  for (const [, field] of Object.entries(fields)) {
    if (isChoiceDeclarationField(field)) {
      for (const choice of field.choices) choiceGroups.set(choice, field.choices);
    }
  }
  if (isResourceIdentifier(flatProfile.base)) {
    autoFields.push({ name: "resourceType", value: JSON.stringify(flatProfile.base.name) });
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.excluded) continue;
    if (isChoiceInstanceField(field)) {
      pendingChoiceInstances.push([name, field]);
      continue;
    }
    if (isChoiceDeclarationField(field)) {
      tryPromoteChoice(field, fields, params, promotedChoices);
      continue;
    }
    if (field.valueConstraint) {
      const value = JSON.stringify(field.valueConstraint.value);
      autoFields.push({ name, value: field.array ? `[${value}]` : value });
      if (isNotChoiceDeclarationField(field) && field.type) {
        const pyType = fieldPyType(field, resolveRef);
        autoAccessors.push({ name, pyType, typeId: field.type });
      }
      continue;
    }
    if (isNotChoiceDeclarationField(field)) {
      const sliceNames = collectRequiredSliceNames(field);
      if (sliceNames) {
        if (field.type) {
          const pyType = fieldPyType(field, resolveRef);
          sliceAutoFields.push({ name, pyType, typeId: field.type, sliceNames });
          autoAccessors.push({ name, pyType, typeId: field.type });
        }
        continue;
      }
    }
    if (field.required) {
      const pyType = fieldPyType(field, resolveRef);
      params.push({ name, pyType, typeId: field.type });
    }
  }
  collectBaseRequiredParams(tsIndex, flatProfile, resolveRef, params, [
    ...autoFields.map((f) => f.name),
    ...sliceAutoFields.map((f) => f.name),
    ...params.map((f) => f.name),
    ...promotedChoices
  ]);
  const choiceAccessors = [];
  for (const [name, field] of pendingChoiceInstances) {
    if (promotedChoices.has(name)) continue;
    const pyType = pyTypeFromIdentifier(field.type) + (field.array ? "[]" : "");
    const choiceSiblings = (choiceGroups.get(name) ?? []).filter((s) => s !== name && !promotedChoices.has(s));
    choiceAccessors.push({ name, pyType, typeId: field.type, choiceSiblings });
  }
  return { autoFields, sliceAutoFields, params, accessors: [...autoAccessors, ...choiceAccessors] };
};
var buildParamSignature = (factoryInfo, formatName2) => {
  const parts = [];
  for (const f of factoryInfo.sliceAutoFields) {
    parts.push(`${pyFieldName(f.name, formatName2)}: ${f.pyType} | None = None`);
  }
  for (const p of factoryInfo.params) {
    parts.push(`${pyFieldName(p.name, formatName2)}: ${p.pyType}`);
  }
  if (parts.length === 0) return "";
  return `*, ${parts.join(", ")}`;
};
var buildCallArgs = (factoryInfo, formatName2) => {
  const parts = [];
  for (const f of factoryInfo.sliceAutoFields) {
    const name = pyFieldName(f.name, formatName2);
    parts.push(`${name}=${name}`);
  }
  for (const p of factoryInfo.params) {
    const name = pyFieldName(p.name, formatName2);
    parts.push(`${name}=${name}`);
  }
  return parts.join(", ");
};
var generateCreateResource = (w, baseTypeName, annotatedBaseTypeName, isResourceBase, hasParams, factoryInfo) => {
  const fmt = w.nameFormatFunction;
  w.line("@classmethod");
  if (hasParams) {
    w.line(`def create_resource(cls, ${buildParamSignature(factoryInfo, fmt)}) -> ${annotatedBaseTypeName}:`);
  } else {
    w.line(`def create_resource(cls) -> ${annotatedBaseTypeName}:`);
  }
  w.indentBlock(() => {
    for (const f of factoryInfo.sliceAutoFields) {
      const fieldName = pyFieldName(f.name, fmt);
      const matchRefs = f.sliceNames.map((s) => `cls.${pySliceStaticName(s)}`);
      if (matchRefs.length === 1) {
        w.line(`${fieldName}_with_defaults = ensure_slice_defaults(list(${fieldName} or []), ${matchRefs[0]})`);
      } else {
        w.line(`${fieldName}_with_defaults = ensure_slice_defaults(`);
        w.indentBlock(() => {
          w.line(`list(${fieldName} or []),`);
          for (const ref of matchRefs) w.line(`${ref},`);
        });
        w.line(")");
      }
    }
    if (factoryInfo.sliceAutoFields.length > 0) w.line();
    const buildArgs = [];
    for (const f of factoryInfo.autoFields) {
      buildArgs.push(`${pyFieldName(f.name, fmt)}=${f.value}`);
    }
    for (const f of factoryInfo.sliceAutoFields) {
      buildArgs.push(`${pyFieldName(f.name, fmt)}=${pyFieldName(f.name, fmt)}_with_defaults`);
    }
    for (const p of factoryInfo.params) {
      buildArgs.push(`${pyFieldName(p.name, fmt)}=${pyFieldName(p.name, fmt)}`);
    }
    if (isResourceBase) {
      buildArgs.push(`meta={"profile": [cls.canonical_url]}`);
    }
    if (buildArgs.length <= 2) {
      w.line(`return build_resource(${baseTypeName}, ${buildArgs.join(", ")})`);
    } else {
      w.line(`return build_resource(`);
      w.indentBlock(() => {
        w.line(`${baseTypeName},`);
        for (const arg of buildArgs) {
          w.line(`${arg},`);
        }
      });
      w.line(")");
    }
  });
};
var generateFieldAccessors = (w, className, factoryInfo, extSliceMethodBaseNames) => {
  const fmt = w.nameFormatFunction;
  for (const p of factoryInfo.params) {
    const fieldName = pyFieldName(p.name, fmt);
    const methodSuffix = pySnakeName(p.name);
    w.line(`def get_${methodSuffix}(self) -> ${p.pyType} | None:`);
    w.indentBlock(() => {
      w.line(`return cast('${p.pyType} | None', getattr(self._resource, ${JSON.stringify(fieldName)}, None))`);
    });
    w.line();
    w.line(`def set_${methodSuffix}(self, value: ${p.pyType}) -> "${className}":`);
    w.indentBlock(() => {
      w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, value)`);
      w.line("return self");
    });
    w.line();
  }
  for (const a of factoryInfo.accessors) {
    const methodSuffix = pySnakeName(a.name);
    if (extSliceMethodBaseNames.has(methodSuffix)) continue;
    const fieldName = pyFieldName(a.name, fmt);
    w.line(`def get_${methodSuffix}(self) -> ${a.pyType} | None:`);
    w.indentBlock(() => {
      w.line(`return cast('${a.pyType} | None', getattr(self._resource, ${JSON.stringify(fieldName)}, None))`);
    });
    w.line();
    w.line(`def set_${methodSuffix}(self, value: ${a.pyType}) -> "${className}":`);
    w.indentBlock(() => {
      if (a.choiceSiblings?.length) {
        for (const sibling of a.choiceSiblings) {
          w.line(`setattr(self._resource, ${JSON.stringify(pyFieldName(sibling, fmt))}, None)`);
        }
      }
      w.line(`setattr(self._resource, ${JSON.stringify(fieldName)}, value)`);
      w.line("return self");
    });
    w.line();
  }
};

// src/api/writer-generator/python/profile-validation.ts
var collectValidateBody = (flatProfile, resolveRef, errorLines, warningLines, formatName2) => {
  const helpers = /* @__PURE__ */ new Set();
  const fields = flatProfile.fields;
  for (const [name, field] of Object.entries(fields)) {
    const pyName = pyFieldName(name, formatName2);
    if (isChoiceInstanceField(field)) {
      collectProhibitedChoiceValidation(fields, name, pyName, helpers, errorLines);
      continue;
    }
    if (isChoiceDeclarationField(field)) {
      if (field.required) {
        helpers.add("validate_choice_required");
        const pyChoices = field.choices.map((c) => pyFieldName(c, formatName2));
        errorLines.push(
          `errors.extend(validate_choice_required(self._resource, profile_name, ${JSON.stringify(pyChoices)}))`
        );
      }
      continue;
    }
    if (field.excluded) {
      helpers.add("validate_excluded");
      errorLines.push(
        `errors.extend(validate_excluded(self._resource, profile_name, ${JSON.stringify(pyName)}))`
      );
      continue;
    }
    if (field.required) {
      helpers.add("validate_required");
      errorLines.push(
        `errors.extend(validate_required(self._resource, profile_name, ${JSON.stringify(pyName)}))`
      );
    }
    if (field.valueConstraint) {
      helpers.add("validate_fixed_value");
      const value = JSON.stringify(field.valueConstraint.value);
      errorLines.push(
        `errors.extend(validate_fixed_value(self._resource, profile_name, ${JSON.stringify(pyName)}, ${value}))`
      );
    }
    if (isNotChoiceDeclarationField(field)) {
      if (field.enum) {
        helpers.add("validate_enum");
        const target = field.enum.isOpen ? warningLines : errorLines;
        const listName = field.enum.isOpen ? "warnings" : "errors";
        target.push(
          `${listName}.extend(validate_enum(self._resource, profile_name, ${JSON.stringify(pyName)}, ${JSON.stringify(field.enum.values)}))`
        );
      }
      if (field.mustSupport && !field.required) {
        helpers.add("validate_must_support");
        warningLines.push(
          `warnings.extend(validate_must_support(self._resource, profile_name, ${JSON.stringify(pyName)}))`
        );
      }
      if (field.reference && field.reference.resource.length > 0) {
        helpers.add("validate_reference");
        const allowed = field.reference.resource.map((ref) => resolveRef(ref).name);
        errorLines.push(
          `errors.extend(validate_reference(self._resource, profile_name, ${JSON.stringify(pyName)}, ${JSON.stringify(allowed)}))`
        );
      }
      if (field.slicing?.slices) {
        collectSliceCardinalityValidation(field, pyName, helpers, errorLines);
      }
    }
  }
  return helpers;
};
var collectProhibitedChoiceValidation = (fields, name, pyName, helpers, errorLines) => {
  const field = fields[name];
  if (!field || !isChoiceInstanceField(field)) return;
  const decl = fields[field.choiceOf];
  if (!decl || !isChoiceDeclarationField(decl) || !decl.prohibited?.includes(name)) return;
  helpers.add("validate_excluded");
  errorLines.push(`errors.extend(validate_excluded(self._resource, profile_name, ${JSON.stringify(pyName)}))`);
};
var collectSliceCardinalityValidation = (field, name, helpers, errorLines) => {
  if (!field.slicing?.slices) return;
  for (const [sliceName, slice] of Object.entries(field.slicing.slices)) {
    if (slice.min === void 0 && slice.max === void 0) continue;
    const match = slice.match ?? {};
    if (Object.keys(match).length === 0) continue;
    const min = slice.min ?? 0;
    const max = slice.max ?? 0;
    helpers.add("validate_slice_cardinality");
    errorLines.push(
      `errors.extend(validate_slice_cardinality(self._resource, profile_name, ${JSON.stringify(name)}, ${JSON.stringify(match)}, ${JSON.stringify(sliceName)}, ${min}, ${max}))`
    );
  }
};

// src/api/writer-generator/python/profile.ts
var modulePathForTypeId = (rootPackageName, typeId) => {
  const pkg = pyFhirPackageByName(rootPackageName, typeId.package);
  if (isResourceIdentifier(typeId)) return `${pkg}.${snakeCase(typeId.name)}`;
  if (isNestedIdentifier(typeId)) {
    const path = canonicalToName2(typeId.url, false);
    const parentName = path?.split("#")[0];
    return parentName ? `${pkg}.${snakeCase(parentName)}` : `${pkg}.base`;
  }
  return `${pkg}.base`;
};
var addExactTypeImport = (typeImports, rootPackageName, skipName, typeId) => {
  if (isPrimitiveIdentifier(typeId) || PRIMITIVE_TYPE_MAP2[typeId.name] !== void 0) return;
  const name = deriveResourceName(typeId);
  if (!name || name === skipName) return;
  const modulePath = modulePathForTypeId(rootPackageName, typeId);
  const names = typeImports.get(modulePath) ?? /* @__PURE__ */ new Set();
  names.add(name);
  typeImports.set(modulePath, names);
};
var addTypeImport = (typeImports, rootPackageName, skipName, resolveRef, typeId) => {
  const ids = [typeId];
  const resolved = resolveRef(typeId);
  if (resolved !== typeId) ids.push(resolved);
  for (const id of ids) {
    if (isPrimitiveIdentifier(id) || PRIMITIVE_TYPE_MAP2[id.name] !== void 0) continue;
    const name = deriveResourceName(id);
    if (name === skipName) continue;
    const modulePath = modulePathForTypeId(rootPackageName, id);
    let names = typeImports.get(modulePath);
    if (!names) {
      names = /* @__PURE__ */ new Set();
      typeImports.set(modulePath, names);
    }
    names.add(name);
  }
};
var collectHelperImports = (isResourceBase, factoryInfo, sliceDefs, extensions, validationHelpers) => {
  const imports = ["build_resource"];
  if (isResourceBase) imports.push("ensure_profile");
  if (factoryInfo.sliceAutoFields.length > 0) imports.push("ensure_slice_defaults");
  if (sliceDefs.length > 0) {
    const hasNonTyped = sliceDefs.some((s) => !s.isTypeDiscriminated);
    const hasTypedBounded = sliceDefs.some((s) => s.isTypeDiscriminated && !(s.array && s.max === 0));
    const hasTypedUnbounded = sliceDefs.some((s) => s.isTypeDiscriminated && s.array && s.max === 0);
    if (hasNonTyped) imports.push("apply_slice_match", "matches_value", "strip_match_keys");
    if (hasTypedBounded || hasNonTyped) imports.push("get_array_slice", "set_array_slice");
    if (hasTypedUnbounded) imports.push("get_array_slices", "set_array_slices");
    if (sliceDefs.some((s) => s.constrainedChoice)) imports.push("wrap_slice_choice", "unwrap_slice_choice");
  }
  if (extensions.length > 0) {
    imports.push("_get_key", "is_extension", "get_extension_value", "push_extension");
    if (extensions.some((ext) => ext.isComplex && ext.subExtensions)) imports.push("extract_complex_extension");
    if (extensions.some((ext) => ext.path.split(".").some((s) => s !== "extension"))) imports.push("ensure_path");
    const hasDictFormSetter = extensions.some(
      (ext) => ext.isComplex && ext.subExtensions || !(ext.valueFieldTypes?.length === 1 && ext.valueFieldTypes[0])
    );
    if (hasDictFormSetter) imports.push("is_record");
  }
  imports.push(...validationHelpers);
  imports.sort();
  return imports;
};
var collectTypeImports = (rootPackageName, baseTypeName, resolveRef, factoryInfo, sliceDefs, extensions, schemas) => {
  const typeImports = /* @__PURE__ */ new Map();
  for (const p of factoryInfo.params) addTypeImport(typeImports, rootPackageName, baseTypeName, resolveRef, p.typeId);
  for (const f of factoryInfo.sliceAutoFields)
    addTypeImport(typeImports, rootPackageName, baseTypeName, resolveRef, f.typeId);
  for (const a of factoryInfo.accessors)
    addTypeImport(typeImports, rootPackageName, baseTypeName, resolveRef, a.typeId);
  for (const s of sliceDefs) {
    if (s.elementTypeId) addExactTypeImport(typeImports, rootPackageName, baseTypeName, s.elementTypeId);
    if (!s.isTypeDiscriminated) continue;
    if (!s.typeDiscriminatorResource) continue;
    const resourceId = schemas.find(
      (schema) => schema.identifier.kind === "resource" && schema.identifier.name === s.typeDiscriminatorResource
    )?.identifier;
    if (resourceId) addTypeImport(typeImports, rootPackageName, baseTypeName, resolveRef, resourceId);
  }
  for (const ext of extensions) {
    if (ext.isComplex && ext.subExtensions) continue;
    if (ext.valueFieldTypes?.length === 1 && ext.valueFieldTypes[0])
      addExactTypeImport(typeImports, rootPackageName, baseTypeName, ext.valueFieldTypes[0]);
  }
  return typeImports;
};
var collectExtProfileImports = (tsIndex, flatProfile, extensions) => {
  const extProfileImports = /* @__PURE__ */ new Map();
  for (const ext of extensions) {
    if (!ext.url) continue;
    const info = resolveExtensionProfile(tsIndex, flatProfile.identifier.package, ext);
    if (info && !extProfileImports.has(info.className)) extProfileImports.set(info.className, info);
  }
  return extProfileImports;
};
var emitModuleImports = (w, flatProfile, isResourceBase, extensions, factoryInfo, typeImports, extProfileImports, helperImports, sliceDefs) => {
  w.line("from __future__ import annotations");
  w.line();
  const usesLiteral = [...factoryInfo.params, ...factoryInfo.accessors, ...factoryInfo.sliceAutoFields].some(
    (f) => f.pyType.includes("Literal[")
  );
  const hasNonTypedSlice = sliceDefs.some((s) => !s.isTypeDiscriminated);
  const needsOverload = extensions.length > 0 || hasNonTypedSlice;
  const needsAny = extensions.length > 0 || sliceDefs.length > 0;
  const needsCast = factoryInfo.params.length > 0 || factoryInfo.accessors.length > 0 || sliceDefs.length > 0 || extensions.length > 0;
  const typingNames = [];
  if (needsAny) typingNames.push("Any");
  if (needsCast) typingNames.push("cast");
  if (needsOverload || usesLiteral) typingNames.push("Literal");
  if (needsOverload) typingNames.push("overload");
  if (typingNames.length > 0) {
    w.pyImportFrom("typing", ...[...typingNames].sort());
    w.line();
  }
  const baseTypeName = flatProfile.base.name;
  const basePkg = pyFhirPackageByName(w.opts.rootPackageName, flatProfile.base.package);
  if (isResourceBase) {
    w.pyImportFrom(`${basePkg}.${snakeCase(baseTypeName)}`, baseTypeName);
  } else {
    w.pyImportFrom(`${basePkg}.base`, baseTypeName);
  }
  if (extensions.length > 0) w.pyImportFrom(`${basePkg}.base`, "Extension");
  for (const [modulePath, names] of [...typeImports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    w.pyImportFrom(modulePath, ...[...names].sort());
  }
  for (const [extClassName, info] of [...extProfileImports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    w.pyImportFrom(`.${info.moduleName}`, extClassName);
  }
  w.pyImportFrom(`${w.opts.rootPackageName}.profile_helpers`, ...helperImports);
  w.line();
  w.line();
};
var generateFromResourceMethod = (w, annotatedBaseTypeName, className, isResourceBase) => {
  w.line("@classmethod");
  w.line(`def from_resource(cls, resource: ${annotatedBaseTypeName}) -> "${className}":`);
  w.indentBlock(() => {
    if (isResourceBase) {
      w.line('meta = getattr(resource, "meta", None)');
      w.line('profiles = getattr(meta, "profile", None) if meta is not None else None');
      w.line("if profiles is None or cls.canonical_url not in profiles:");
      w.indentBlock(() => {
        w.line(`raise ValueError(f"${className}: meta.profile must include {cls.canonical_url}")`);
      });
    }
    w.line("profile = cls(resource)");
    w.line("result = profile.validate()");
    w.line('if result["errors"]:');
    w.indentBlock(() => w.line('raise ValueError("; ".join(result["errors"]))'));
    w.line("return profile");
  });
  w.line();
};
var generateApplyMethod = (w, annotatedBaseTypeName, className, isResourceBase) => {
  w.line("@classmethod");
  w.line(`def apply(cls, resource: ${annotatedBaseTypeName}) -> "${className}":`);
  w.indentBlock(() => {
    if (isResourceBase) w.line("ensure_profile(resource, cls.canonical_url)");
    w.line("return cls(resource)");
  });
  w.line();
};
var generateCreateMethod = (w, className, hasParams, factoryInfo) => {
  w.line("@classmethod");
  if (hasParams) {
    w.line(`def create(cls, ${buildParamSignature(factoryInfo, w.nameFormatFunction)}) -> "${className}":`);
    w.indentBlock(
      () => w.line(`return cls.apply(cls.create_resource(${buildCallArgs(factoryInfo, w.nameFormatFunction)}))`)
    );
  } else {
    w.line(`def create(cls) -> "${className}":`);
    w.indentBlock(() => w.line("return cls.apply(cls.create_resource())"));
  }
  w.line();
};
var generateValidateMethod = (w, className, errorLines, warningLines) => {
  w.line("def validate(self) -> dict[str, list[str]]:");
  w.indentBlock(() => {
    w.line(`profile_name = "${className}"`);
    w.line("errors: list[str] = []");
    w.line("warnings: list[str] = []");
    for (const expr of errorLines) w.line(expr);
    for (const expr of warningLines) w.line(expr);
    w.line('return {"errors": errors, "warnings": warnings}');
  });
};
var generateClassBody = (ctx) => {
  const {
    w,
    tsIndex,
    flatProfile,
    baseTypeName,
    annotatedBaseTypeName,
    className,
    isResourceBase,
    errorLines,
    warningLines,
    factoryInfo,
    sliceDefs,
    resolvedNames
  } = ctx;
  const hasParams = factoryInfo.params.length > 0 || factoryInfo.sliceAutoFields.length > 0;
  w.line(`def __init__(self, resource: ${annotatedBaseTypeName}) -> None:`);
  w.indentBlock(() => w.line("self._resource = resource"));
  w.line();
  generateFromResourceMethod(w, annotatedBaseTypeName, className, isResourceBase);
  generateApplyMethod(w, annotatedBaseTypeName, className, isResourceBase);
  generateCreateResource(w, baseTypeName, annotatedBaseTypeName, isResourceBase, hasParams, factoryInfo);
  w.line();
  generateCreateMethod(w, className, hasParams, factoryInfo);
  w.line(`def to_resource(self) -> ${annotatedBaseTypeName}:`);
  w.indentBlock(() => w.line("return self._resource"));
  w.line();
  if (factoryInfo.params.length > 0 || factoryInfo.accessors.length > 0)
    generateFieldAccessors(w, className, factoryInfo, resolvedNames.allBaseNames);
  const extensions = flatProfile.extensions ?? [];
  if (extensions.length > 0) generateExtensionMethods(w, tsIndex, flatProfile, className, resolvedNames.extensions);
  if (sliceDefs.length > 0) {
    generateSliceGetters(w, sliceDefs, resolvedNames.slices);
    generateSliceSetters(w, className, sliceDefs, resolvedNames.slices);
  }
  generateValidateMethod(w, className, errorLines, warningLines);
};
var generateProfileModule = (w, tsIndex, flatProfile) => {
  const className = pyProfileClassName(flatProfile);
  const baseTypeName = flatProfile.base.name;
  const isResourceBase = isResourceIdentifier(flatProfile.base);
  const canonicalUrl = flatProfile.identifier.url ?? "";
  const factoryInfo = collectProfileFactoryInfo(tsIndex, flatProfile);
  const sliceDefs = collectSliceDefs(tsIndex, flatProfile);
  const typedResources = [
    ...new Set(
      sliceDefs.filter((s) => s.isTypeDiscriminated && s.typeDiscriminatorResource).map((s) => s.typeDiscriminatorResource)
    )
  ];
  const annotatedBaseTypeName = typedResources.length > 0 ? `${baseTypeName}[${typedResources.join(" | ")}, Resource]` : baseTypeName;
  const extensions = flatProfile.extensions ?? [];
  const resolvedNames = resolveProfileMethodBaseNames(extensions, sliceDefs);
  const errorLines = [];
  const warningLines = [];
  const validationHelpers = collectValidateBody(
    flatProfile,
    tsIndex.findLastSpecializationByIdentifier,
    errorLines,
    warningLines,
    w.nameFormatFunction
  );
  const helperImports = collectHelperImports(isResourceBase, factoryInfo, sliceDefs, extensions, validationHelpers);
  const typeImports = collectTypeImports(
    w.opts.rootPackageName,
    baseTypeName,
    tsIndex.findLastSpecializationByIdentifier,
    factoryInfo,
    sliceDefs,
    extensions,
    tsIndex.schemas
  );
  const extProfileImports = collectExtProfileImports(tsIndex, flatProfile, extensions);
  if (typedResources.length > 0) {
    const basePkg = pyFhirPackageByName(w.opts.rootPackageName, flatProfile.base.package);
    const resourceModule = `${basePkg}.resource`;
    const names = typeImports.get(resourceModule) ?? /* @__PURE__ */ new Set();
    names.add("Resource");
    typeImports.set(resourceModule, names);
  }
  emitModuleImports(
    w,
    flatProfile,
    isResourceBase,
    extensions,
    factoryInfo,
    typeImports,
    extProfileImports,
    helperImports,
    sliceDefs
  );
  w.line(`class ${className}:`);
  w.indentBlock(() => {
    if (flatProfile.description) {
      w.line(`"""${flatProfile.description}`);
      w.line();
      w.line(`CanonicalURL: ${canonicalUrl}`);
      w.line(`"""`);
      w.line();
    }
    w.line(`canonical_url: str = ${JSON.stringify(canonicalUrl)}`);
    w.line();
    generateStaticSliceFields(w, sliceDefs);
    generateClassBody({
      w,
      tsIndex,
      flatProfile,
      baseTypeName,
      annotatedBaseTypeName,
      className,
      isResourceBase,
      factoryInfo,
      sliceDefs,
      resolvedNames,
      errorLines,
      warningLines
    });
  });
  w.line();
};
var generateProfilesInit = (w, tsIndex, profiles) => {
  w.cat("__init__.py", () => {
    w.generateDisclaimer();
    const seen = /* @__PURE__ */ new Set();
    for (const profile of profiles) {
      const className = pyProfileClassName(profile);
      const moduleName = pyProfileModuleName(tsIndex, profile);
      if (seen.has(className)) continue;
      seen.add(className);
      w.pyImportFrom(`.${moduleName}`, className);
    }
    w.line();
    w.squareBlock(["__all__", "="], () => {
      for (const className of [...seen].sort()) w.line(`'${className}',`);
    });
  });
};
var generateNewProfiles = (w, tsIndex, profiles) => {
  if (profiles.length === 0) return;
  w.cd("profiles", () => {
    for (const profile of profiles) {
      const moduleName = pyProfileModuleName(tsIndex, profile);
      w.cat(`${moduleName}.py`, () => {
        w.generateDisclaimer();
        generateProfileModule(w, tsIndex, profile);
      });
    }
    generateProfilesInit(w, tsIndex, profiles);
  });
};

// src/api/writer-generator/python/writer.ts
var resolvePyAssets = (fn) => {
  const __dirname = Path5.dirname(fileURLToPath(import.meta.url));
  const __filename = fileURLToPath(import.meta.url);
  if (__filename.endsWith("dist/index.js")) {
    return Path5.resolve(__dirname, "..", "assets", "api", "writer-generator", "python", fn);
  }
  return Path5.resolve(__dirname, "../../../..", "assets", "api", "writer-generator", "python", fn);
};
var AVAILABLE_STRING_FORMATS = {
  snake_case: snakeCase,
  PascalCase: pascalCase,
  camelCase
};
var MAX_IMPORT_LINE_LENGTH = 100;
var GENERIC_FIELD_REWRITES = {
  Coding: { code: "T" },
  CodeableConcept: { coding: "Coding[T]" }
};
var leafOf2 = (path) => path[path.length - 1] ?? "";
var collectResourceGenericTypeVars = (schema) => {
  const all = /* @__PURE__ */ new Map();
  const addParams = (s) => {
    for (const p of s.generic?.params ?? []) {
      if (!all.has(p.typeVar)) all.set(p.typeVar, p.constraint.name);
    }
  };
  addParams(schema);
  for (const nested of schema.nested ?? []) addParams(nested);
  return Array.from(all.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([typeVar, constraint]) => ({ typeVar, constraint }));
};
var pyEnumType = (enumDef) => {
  const values = enumDef.values.map((e) => `"${e}"`).join(", ");
  return enumDef.isOpen ? `Literal[${values}] | str` : `Literal[${values}]`;
};
var Python = class extends Writer {
  nameFormatFunction;
  tsIndex;
  forFhirpyClient;
  fieldFormat;
  constructor(options) {
    super({ ...options, resolveAssets: options.resolveAssets ?? resolvePyAssets });
    this.nameFormatFunction = this.getFieldFormatFunction(options.fieldFormat);
    this.forFhirpyClient = this.resolveClient(options);
    this.fieldFormat = options.fieldFormat;
  }
  /** Resolve which client integration to emit. `client` wins; `fhirpyClient` is the deprecated fallback; default is fhirpy. */
  resolveClient(options) {
    if (options.client !== void 0) return options.client === "fhirpy";
    if (options.fhirpyClient !== void 0) {
      this.logger()?.warn('python: `fhirpyClient` is deprecated; use `client: "fhirpy" | "none"` instead.');
      return options.fhirpyClient;
    }
    return true;
  }
  async generate(tsIndex) {
    this.tsIndex = tsIndex;
    const groups = {
      groupedComplexTypes: groupByPackages(tsIndex.collectComplexTypes()),
      groupedResources: groupByPackages(tsIndex.collectResources())
    };
    const hasProfiles = (this.opts.generateProfile ?? false) && tsIndex.collectSnapshotProfiles().length > 0;
    this.generateRootPackages(groups, hasProfiles);
    this.generateSDKPackages(tsIndex, groups);
  }
  generateRootPackages(groups, hasProfiles) {
    this.generateRootInitFile(groups);
    if (this.forFhirpyClient) {
      if (this.fieldFormat === "camelCase") {
        this.copyAssets(resolvePyAssets("fhirpy_base_model_camel_case.py"), "fhirpy_base_model.py");
      } else {
        this.copyAssets(resolvePyAssets("fhirpy_base_model.py"), "fhirpy_base_model.py");
      }
    }
    if (hasProfiles) {
      this.copyAssets(resolvePyAssets("profile_helpers.py"), "profile_helpers.py");
    }
    this.copyAssets(resolvePyAssets("requirements.txt"), "requirements.txt");
  }
  generateSDKPackages(tsIndex, groups) {
    this.generateComplexTypesPackages(groups.groupedComplexTypes);
    this.generateResourcePackages(tsIndex, groups);
  }
  generateComplexTypesPackages(groupedComplexTypes) {
    for (const [packageName, packageComplexTypes] of Object.entries(groupedComplexTypes)) {
      this.cd(`/${snakeCase(packageName)}`, () => {
        this.generateBasePy(packageName, packageComplexTypes);
      });
    }
  }
  generateResourcePackages(tsIndex, groups) {
    const profilesByPackage = this.opts.generateProfile ? groupByPackages(tsIndex.collectSnapshotProfiles()) : {};
    for (const [packageName, packageResources] of Object.entries(groups.groupedResources)) {
      this.cd(`/${snakeCase(packageName)}`, () => {
        this.generateResourcePackageContent(
          packageName,
          packageResources,
          groups.groupedComplexTypes[packageName] || []
        );
        const packageProfiles = profilesByPackage[packageName];
        if (packageProfiles && packageProfiles.length > 0) {
          generateNewProfiles(this, tsIndex, packageProfiles);
        }
      });
    }
    for (const [packageName, packageProfiles] of Object.entries(profilesByPackage)) {
      if (groups.groupedResources[packageName]) continue;
      if (!packageProfiles || packageProfiles.length === 0) continue;
      this.cd(`/${snakeCase(packageName)}`, () => {
        generateNewProfiles(this, tsIndex, packageProfiles);
      });
    }
  }
  generateResourcePackageContent(packageName, packageResources, packageComplexTypes) {
    const pyPackageName = pyFhirPackageByName(this.opts.rootPackageName, packageName);
    this.generateResourcePackageInit(pyPackageName, packageResources, packageComplexTypes);
    const hasAnyResourceGenericParams = packageResources.some((s) => collectResourceGenericTypeVars(s).length > 0);
    if (hasAnyResourceGenericParams) {
      this.copyAssets(resolvePyAssets("resource_preprocessor.py"), "resource_preprocessor.py");
    }
    for (const schema of packageResources) {
      this.generateResourceModule(schema);
    }
  }
  generateRootInitFile(groups) {
    this.cd("/", () => {
      this.cat("__init__.py", () => {
        this.generateDisclaimer();
        const pydanticModels = this.collectAndImportAllModels(groups);
        this.generateModelRebuilds(pydanticModels);
        this.importProfileRegistrations(groups);
      });
    });
  }
  collectAndImportAllModels(groups) {
    const models = [];
    for (const packageName of Object.keys(groups.groupedResources)) {
      const fullPyPackageName = pyFhirPackageByName(this.opts.rootPackageName, packageName);
      models.push(...this.importComplexTypes(fullPyPackageName, groups.groupedComplexTypes[packageName]));
      models.push(...this.importResources(fullPyPackageName, false, groups.groupedResources[packageName]));
    }
    this.line();
    return models;
  }
  generateModelRebuilds(models) {
    for (const modelName of models.sort()) {
      this.line(`${modelName}.model_rebuild()`);
    }
  }
  importProfileRegistrations(groups) {
    if (!this.opts.generateProfile) return;
    this.line();
    for (const packageName of Object.keys(groups.groupedResources)) {
      const profilesPackage = `${pyFhirPackageByName(this.opts.rootPackageName, packageName)}.profiles`;
      this.line(`import ${profilesPackage}  # noqa: F401`);
    }
  }
  generateBasePy(_packageName, packageComplexTypes) {
    const hasGenericTypes = packageComplexTypes.some((s) => s.identifier.name in GENERIC_FIELD_REWRITES);
    this.cat("base.py", () => {
      this.generateDisclaimer();
      this.generateDefaultImports(hasGenericTypes);
      if (hasGenericTypes) {
        this.line();
        this.line("T = TypeVar('T', bound=str, default=str)");
      }
      this.line();
      this.generateComplexTypes(packageComplexTypes);
      this.line();
    });
  }
  generateComplexTypes(complexTypes) {
    for (const schema of sortAsDeclarationSequence(complexTypes)) {
      this.generateNestedTypes(schema);
      this.line();
      this.generateType(schema);
    }
  }
  generateResourcePackageInit(fullPyPackageName, packageResources, packageComplexTypes) {
    this.cat("__init__.py", () => {
      this.generateDisclaimer();
      this.importComplexTypes(fullPyPackageName, packageComplexTypes);
      const allResourceNames = this.importResources(fullPyPackageName, true, packageResources);
      this.line();
      this.generateExportsDeclaration(packageComplexTypes, allResourceNames);
    });
  }
  importComplexTypes(fullPyPackageName, packageComplexTypes) {
    if (!packageComplexTypes || packageComplexTypes.length === 0) return [];
    const baseTypes = packageComplexTypes.map((t) => t.identifier.name).sort();
    this.pyImportFrom(`${fullPyPackageName}.base`, ...baseTypes);
    this.line();
    return baseTypes;
  }
  buildImportLine(entities, start, maxLen) {
    let line = "";
    let i = start;
    while (i < entities.length && line.length < maxLen) {
      if (line.length > 0) line += ", ";
      line += entities[i];
      i++;
    }
    if (i < entities.length) line += ", \\";
    return { line, next: i };
  }
  importResources(fullPyPackageName, importEmptyResources, packageResources) {
    if (!packageResources || packageResources.length === 0) return [];
    const allResourceNames = [];
    for (const resource of packageResources) {
      const names = this.importOneResource(resource, fullPyPackageName);
      if (!importEmptyResources && !resource.fields) continue;
      allResourceNames.push(...names);
    }
    return allResourceNames;
  }
  importOneResource(resource, fullPyPackageName) {
    const moduleName = `${fullPyPackageName}.${snakeCase(resource.identifier.name)}`;
    const importNames = this.collectResourceImportNames(resource);
    this.pyImportFrom(moduleName, ...importNames);
    return [...importNames];
  }
  collectResourceImportNames(resource) {
    const names = [deriveResourceName(resource.identifier)];
    for (const nested of resource.nested ?? []) {
      const nestedName = deriveResourceName(nested.identifier);
      names.push(nestedName);
    }
    return names;
  }
  generateExportsDeclaration(packageComplexTypes, allResourceNames) {
    this.squareBlock(["__all__", "="], () => {
      const allExports = [
        ...(packageComplexTypes || []).map((t) => t.identifier.name),
        ...allResourceNames
      ].sort();
      for (const schemaName of allExports) {
        this.line(`'${schemaName}',`);
      }
    });
  }
  generateResourceModule(schema) {
    const typeVars = collectResourceGenericTypeVars(schema);
    const hasResourceGenericParams = typeVars.length > 0;
    this.cat(`${snakeCase(schema.identifier.name)}.py`, () => {
      this.generateDisclaimer();
      this.generateDefaultImports(false, hasResourceGenericParams, true);
      this.generateFhirBaseModelImport();
      this.line();
      this.generateDependenciesImports(schema);
      if (hasResourceGenericParams) {
        const pyFhirPackage2 = pyFhirPackageByName(this.opts.rootPackageName, schema.identifier.package);
        this.pyImportFrom(`${pyFhirPackage2}.resource_preprocessor`, "preprocess_resource_fields");
        this.line();
        for (const { typeVar, constraint } of typeVars) {
          this.line(`${typeVar} = TypeVar('${typeVar}', bound=${constraint}, default=${constraint})`);
        }
      }
      this.line();
      this.generateNestedTypes(schema);
      this.line();
      this.generateType(schema);
    });
  }
  generateFhirBaseModelImport() {
    if (this.forFhirpyClient)
      this.pyImportFrom(`${this.opts.rootPackageName}.fhirpy_base_model`, "FhirpyBaseModel");
  }
  generateType(schema) {
    const className = deriveResourceName(schema.identifier);
    const superClasses = this.getSuperClasses(schema);
    this.line(`class ${className}(${superClasses.join(", ")}):`);
    this.indentBlock(() => {
      this.generateClassBody(schema);
    });
    this.line();
  }
  getSuperClasses(schema) {
    const bases = [];
    if (schema.base) bases.push(schema.base.name);
    bases.push(...this.injectSuperClasses(schema.identifier.url));
    if (schema.identifier.name in GENERIC_FIELD_REWRITES) bases.push("Generic[T]");
    const params = schema.generic?.params ?? [];
    if (params.length > 0) {
      const typeVars = params.map((p) => p.typeVar).join(", ");
      bases.push(`Generic[${typeVars}]`);
    }
    return bases;
  }
  generateClassBody(schema) {
    this.generateModelConfig();
    if (!schema.fields) {
      this.line("pass");
      return;
    }
    if (isResourceTypeSchema(schema)) {
      this.generateResourceTypeField(schema);
    }
    this.generateFields(schema);
    if (this.opts.generateProfile && schema.identifier.name === "Extension") {
      this.generateExtensionEqualityMethods();
    }
    if (isResourceTypeSchema(schema)) {
      this.generateResourceMethods(schema);
    }
    if ((schema.generic?.params?.length ?? 0) > 0) {
      this.generateResourcePreprocessorMethod(schema);
    }
  }
  generateResourcePreprocessorMethod(schema) {
    const pyFhirPackage2 = pyFhirPackageByName(this.opts.rootPackageName, schema.identifier.package);
    this.line();
    this.line("@model_validator(mode='before')");
    this.line("@classmethod");
    this.line("def _preprocess_resources(cls, data: Any) -> Any:");
    this.line("    if isinstance(data, dict):");
    this.line(`        return preprocess_resource_fields(data, "${pyFhirPackage2}")`);
    this.line("    return data");
  }
  generateModelConfig() {
    const extraMode = this.opts.allowExtraFields ? "allow" : "forbid";
    this.line(`model_config = ConfigDict(validate_by_name=True, serialize_by_alias=True, extra="${extraMode}")`);
  }
  generateResourceTypeField(schema) {
    const hasChildren = (schema.typeFamily?.resources?.length ?? 0) > 0;
    this.line(`${this.nameFormatFunction("resourceType")}: str = Field(`);
    this.indentBlock(() => {
      if (!hasChildren) this.line(`default='${schema.identifier.name}',`);
      this.line(`alias='resourceType',`);
      this.line(`serialization_alias='resourceType',`);
      if (!this.forFhirpyClient) {
        this.line("frozen=True,");
      }
      this.line(`pattern='${schema.identifier.name}'`);
    });
    this.line(")");
  }
  generateFields(schema) {
    const sortedFields = Object.entries(schema.fields ?? []).sort(([a], [b]) => a.localeCompare(b));
    const withExtensions = this.shouldAddPrimitiveExtensions(schema);
    for (const [fieldName, field] of sortedFields) {
      if ("choices" in field && field.choices) continue;
      const fieldInfo = this.buildFieldInfo(fieldName, field, schema);
      this.line(`${fieldInfo.name}: ${fieldInfo.type}${fieldInfo.defaultValue}`);
      if (withExtensions && "type" in field && isPrimitiveIdentifier(field.type)) {
        this.addPrimitiveExtensionField(fieldName, field.array ?? false);
      }
    }
  }
  shouldAddPrimitiveExtensions(schema) {
    if (!this.opts.primitiveTypeExtension) return false;
    if (!isSpecializationTypeSchema(schema)) return false;
    for (const field of Object.values(schema.fields ?? {})) {
      if ("choices" in field && field.choices) continue;
      if ("type" in field && isPrimitiveIdentifier(field.type)) return true;
    }
    return false;
  }
  addPrimitiveExtensionField(fieldName, isArray) {
    const pyFieldName2 = this.nameFormatFunction(`${fieldName}Extension`);
    const alias = `_${fieldName}`;
    const typeExpr = isArray ? "PyList[Element | None] | None" : "Element | None";
    const aliasSpec = `alias="${alias}", serialization_alias="${alias}"`;
    this.line(`${pyFieldName2}: ${typeExpr} = Field(None, ${aliasSpec})`);
  }
  buildFieldInfo(fieldName, field, schema) {
    const pyFieldName2 = fixReservedWords(this.nameFormatFunction(fieldName));
    const fieldType = this.determineFieldType(field, fieldName, schema);
    const defaultValue = this.getFieldDefaultValue(field, fieldName);
    return {
      name: pyFieldName2,
      type: fieldType,
      defaultValue
    };
  }
  determineFieldType(field, fieldName, schema) {
    const schemaName = schema.identifier.name;
    let fieldType = field ? this.getBaseFieldType(field) : "";
    const rewrite = GENERIC_FIELD_REWRITES[schemaName]?.[fieldName];
    if (rewrite) {
      fieldType = rewrite;
      if (field.array) fieldType = `PyList[${fieldType}]`;
      if (!field.required) fieldType = `${fieldType} | None`;
      return fieldType;
    }
    const params = schema.generic?.params ?? [];
    const directParam = params.find((p) => leafOf2(p.path) === fieldName);
    if (directParam) {
      fieldType = directParam.typeVar;
      if (field.array) fieldType = `PyList[${fieldType}]`;
      if (!field.required) fieldType = `${fieldType} | None`;
      return fieldType;
    }
    if ("type" in field && field.type && params.length > 0) {
      assert4(this.tsIndex !== void 0);
      const target = this.tsIndex.resolveType(field.type);
      if (target && (isNestedTypeSchema(target) || isSpecializationTypeSchema(target))) {
        const nestedParams = target.generic?.params ?? [];
        if (nestedParams.length > 0) {
          const args = nestedParams.map(
            (np) => params.find((p) => leafOf2(p.path) === leafOf2(np.path))?.typeVar ?? np.typeVar
          );
          fieldType = `${fieldType}[${args.join(", ")}]`;
        }
      }
    }
    if ("enum" in field && field.enum) {
      const baseTypeName = "type" in field ? field.type.name : "";
      if (baseTypeName in GENERIC_FIELD_REWRITES) {
        fieldType = `${fieldType}[${pyEnumType(field.enum)}]`;
      } else if (!field.enum.isOpen) {
        const s = field.enum.values.map((e) => `"${e}"`).join(", ");
        fieldType = `Literal[${s}]`;
      }
    }
    if (field.array) {
      fieldType = `PyList[${fieldType}]`;
    }
    if (!field.required) {
      fieldType = `${fieldType} | None`;
    }
    return fieldType;
  }
  getBaseFieldType(field) {
    if ("type" in field && field.type.kind === "resource") return `${field.type.name}Family`;
    if ("type" in field && field.type.kind === "nested") return deriveResourceName(field.type);
    if ("type" in field && field.type.kind === "primitive-type")
      return PRIMITIVE_TYPE_MAP2[field.type.name] ?? "str";
    return "type" in field ? field.type.name : "";
  }
  getFieldDefaultValue(field, fieldName) {
    const aliasSpec = `alias="${fieldName}", serialization_alias="${fieldName}"`;
    if (!field.required) {
      return ` = Field(None, ${aliasSpec})`;
    }
    return ` = Field(${aliasSpec})`;
  }
  generateResourceMethods(_schema) {
    this.line();
    this.line("def model_post_init(self, __context: Any) -> None:");
    this.line(`    self.__pydantic_fields_set__.add("${this.nameFormatFunction("resourceType")}")`);
    this.line();
    this.line("def to_json(self, indent: int | None = None) -> str:");
    this.line("    return self.model_dump_json(exclude_unset=True, exclude_none=True, indent=indent)");
    this.line();
    this.line("@classmethod");
    this.line("def from_json(cls, json: str) -> Self:");
    this.line("    return cls.model_validate_json(json)");
  }
  generateExtensionEqualityMethods() {
    this.line();
    this.line("def __eq__(self, other: object) -> bool:");
    this.line("    if not isinstance(other, Extension):");
    this.line("        return NotImplemented");
    this.line(
      "    return self.model_dump(by_alias=True, exclude_none=True) == other.model_dump(by_alias=True, exclude_none=True)"
    );
    this.line();
    this.line("def __hash__(self) -> int:");
    this.line("    return hash(self.url)");
  }
  generateNestedTypes(schema) {
    if (!schema.nested) return;
    this.line();
    for (const subtype of schema.nested) {
      this.generateType(subtype);
    }
  }
  generateDefaultImports(includeGenericImports, includeResourceGenericImports = false, includeResourceMethods = false) {
    this.pyImportFrom("__future__", "annotations");
    const pydanticImports = ["BaseModel", "ConfigDict", "Field", "PositiveInt"];
    if (includeResourceGenericImports) pydanticImports.push("model_validator");
    this.pyImportFrom("pydantic", ...pydanticImports.sort());
    const typingImports = ["Any", "List as PyList", "Literal"];
    if (includeGenericImports || includeResourceGenericImports) {
      typingImports.push("Generic");
    }
    this.pyImportFrom("typing", ...typingImports.sort());
    const typingExtImports = [];
    if (includeGenericImports || includeResourceGenericImports) typingExtImports.push("TypeVar");
    if (includeResourceMethods) typingExtImports.push("Self");
    if (typingExtImports.length > 0) this.pyImportFrom("typing_extensions", ...typingExtImports.sort());
  }
  generateDependenciesImports(schema) {
    if (!schema.dependencies || schema.dependencies.length === 0) return;
    this.importComplexTypeDependencies(schema.dependencies);
    this.importResourceDependencies(schema.dependencies);
    this.importElementIfNeeded(schema);
  }
  importElementIfNeeded(schema) {
    if (!this.shouldAddPrimitiveExtensions(schema)) return;
    if (schema.identifier.name === "Element") return;
    if (schema.dependencies?.find((d) => d.name === "Element")) return;
    assert4(this.tsIndex !== void 0);
    const elementUrl = "http://hl7.org/fhir/StructureDefinition/Element";
    const element = this.tsIndex.resolveByUrl(schema.identifier.package, elementUrl);
    if (!element) return;
    const pyPkg = pyPackage(this.opts.rootPackageName, element.identifier);
    this.pyImportFrom(pyPkg, "Element");
  }
  importComplexTypeDependencies(dependencies) {
    const complexTypeDeps = dependencies.filter((dep) => dep.kind === "complex-type");
    const depsByPackage = this.groupDependenciesByPackage(complexTypeDeps);
    for (const [pyPackage2, names] of Object.entries(depsByPackage)) {
      this.pyImportFrom(pyPackage2, ...names.sort());
    }
  }
  importResourceDependencies(dependencies) {
    const resourceDeps = dependencies.filter((dep) => dep.kind === "resource");
    for (const dep of resourceDeps) {
      this.pyImportType(dep);
    }
  }
  groupDependenciesByPackage(dependencies) {
    const grouped = {};
    for (const dep of dependencies) {
      const pyPkg = pyPackage(this.opts.rootPackageName, dep);
      if (!grouped[pyPkg]) {
        grouped[pyPkg] = [];
      }
      grouped[pyPkg].push(dep.name);
    }
    return grouped;
  }
  pyImportFrom(pyPackage2, ...entities) {
    const oneLine = `from ${pyPackage2} import ${entities.join(", ")}`;
    if (this.shouldUseSingleLineImport(oneLine, entities)) {
      this.line(oneLine);
    } else {
      this.writeMultiLineImport(pyPackage2, entities);
    }
  }
  shouldUseSingleLineImport(oneLine, entities) {
    return oneLine.length <= MAX_IMPORT_LINE_LENGTH || entities.length === 1;
  }
  writeMultiLineImport(pyPackage2, entities) {
    this.line(`from ${pyPackage2} import (`);
    this.indentBlock(() => {
      let i = 0;
      while (i < entities.length) {
        const { line, next } = this.buildImportLine(entities, i, MAX_IMPORT_LINE_LENGTH);
        this.line(line);
        i = next;
      }
    });
    this.line(")");
  }
  pyImportType(identifier) {
    this.pyImportFrom(pyPackage(this.opts.rootPackageName, identifier), pascalCase(identifier.name));
  }
  getFieldFormatFunction(format2) {
    if (!AVAILABLE_STRING_FORMATS[format2]) {
      this.logger()?.warn(`Unknown field format '${format2}'. Defaulting to SnakeCase.`);
      this.logger()?.warn(`Supported formats: ${Object.keys(AVAILABLE_STRING_FORMATS).join(", ")}`);
      return snakeCase;
    }
    return AVAILABLE_STRING_FORMATS[format2];
  }
  injectSuperClasses(url) {
    const name = canonicalToName2(url);
    if (name === "resource") return this.forFhirpyClient ? ["FhirpyBaseModel"] : ["BaseModel"];
    if (name === "element") return ["BaseModel"];
    return [];
  }
};

// src/typeschema/collision-order.ts
var compareStrings = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};
var compareCollisionSources = (left, right) => compareStrings(left.sourcePackage, right.sourcePackage) || compareStrings(left.sourceCanonical, right.sourceCanonical);
var collisionSourcesKey = (sources) => JSON.stringify(
  [...sources].sort(compareCollisionSources).map(({ sourcePackage, sourceCanonical }) => [sourcePackage, sourceCanonical])
);
var compareCollisionVariants = (left, right) => right.sources.length - left.sources.length || compareStrings(collisionSourcesKey(left.sources), collisionSourcesKey(right.sources)) || compareStrings(left.schemaHash, right.schemaHash);

// src/typeschema/skip-hack.ts
var codeableReferenceInR4 = "Use CodeableReference which is not provided by FHIR R4.";
var availabilityInR4 = "Use Availability which is not provided by FHIR R4.";
var skipList = {
  "hl7.fhir.uv.extensions.r4": {
    "http://hl7.org/fhir/StructureDefinition/biologicallyderivedproduct-manipulation": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/biologicallyderivedproduct-processing": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/extended-contact-availability": availabilityInR4,
    "http://hl7.org/fhir/StructureDefinition/immunization-procedure": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/specimen-additive": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/workflow-barrier": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/workflow-protectiveFactor": codeableReferenceInR4,
    "http://hl7.org/fhir/StructureDefinition/workflow-reason": codeableReferenceInR4
  },
  "hl7.fhir.r5.core#5.0.0": {
    "http://hl7.org/fhir/StructureDefinition/shareablecodesystem": "FIXME: CodeSystem.concept.concept defined by ElementReference. FHIR Schema generator output broken value in it, so we just skip it for now.",
    "http://hl7.org/fhir/StructureDefinition/publishablecodesystem": "Uses R5-only base types not available in R4 generation."
  }
};
function shouldSkipCanonical(packageMeta2, canonicalUrl) {
  const pkgId = `${packageMeta2.name}#${packageMeta2.version}`;
  const reasonByPkgId = skipList[pkgId]?.[canonicalUrl];
  if (reasonByPkgId) {
    return { shouldSkip: true, reason: reasonByPkgId };
  }
  const reasonByName = skipList[packageMeta2.name]?.[canonicalUrl];
  if (reasonByName) {
    return { shouldSkip: true, reason: reasonByName };
  }
  return { shouldSkip: false };
}

// src/typeschema/core/identifier.ts
function dropVersionFromUrl(url) {
  const baseUrl = url.split("|")[0];
  return baseUrl ? baseUrl : url;
}
function getVersionFromUrl(url) {
  const version = url.split("|")[1];
  return version;
}
var identifierBase = (fhirSchema) => ({
  package: fhirSchema.package_meta.name,
  version: fhirSchema.package_meta.version,
  name: fhirSchema.name,
  url: fhirSchema.url
});
function mkIdentifier(fhirSchema) {
  const fields = identifierBase(fhirSchema);
  if (fhirSchema.derivation === "constraint") return { kind: "profile", ...fields };
  if (fhirSchema.kind === "primitive-type") return { kind: "primitive-type", ...fields };
  if (fhirSchema.kind === "complex-type") return { kind: "complex-type", ...fields };
  if (fhirSchema.kind === "resource") return { kind: "resource", ...fields };
  if (fhirSchema.kind === "logical") return { kind: "logical", ...fields };
  return { kind: "resource", ...fields };
}
var VALUE_SET_NAME_SPLIT_RE = /[-_]/;
var OPAQUE_VALUE_SET_ID_RE = /^[a-zA-Z0-9_-]{20,}$/;
var getValueSetName = (url) => {
  const urlParts = url.split("/");
  const lastSegment = urlParts[urlParts.length - 1];
  if (lastSegment && lastSegment.length > 0) {
    return lastSegment.split(VALUE_SET_NAME_SPLIT_RE).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
  }
  return url;
};
function mkValueSetIdentifierByUrl(register, pkg, fullValueSetUrl) {
  const valueSetUrl = dropVersionFromUrl(fullValueSetUrl);
  const valueSetNameFallback = getValueSetName(valueSetUrl);
  const valuesSetFallback = {
    package_meta: {
      name: "missing_valuesets",
      version: getVersionFromUrl(valueSetUrl) || "0.0.0"
    },
    id: fullValueSetUrl};
  const valueSet = register.resolveVs(pkg, valueSetUrl) || valuesSetFallback;
  const valueSetName = valueSet?.id && !OPAQUE_VALUE_SET_ID_RE.test(valueSet.id) ? valueSet.id : valueSetNameFallback;
  return {
    kind: "value-set",
    package: valueSet.package_meta.name,
    version: valueSet.package_meta.version,
    name: valueSetName,
    url: valueSetUrl
  };
}
function mkBindingIdentifier(fhirSchema, path, element) {
  const bindingName = element.binding?.bindingName;
  const pathStr = path.join(".");
  const [pkg, name, url] = bindingName ? [{ name: "shared", version: "1.0.0" }, bindingName, `urn:fhir:binding:${bindingName}`] : [fhirSchema.package_meta, `${fhirSchema.name}.${pathStr}_binding`, `${fhirSchema.url}#${pathStr}_binding`];
  return {
    kind: "binding",
    package: pkg.name,
    version: pkg.version,
    name,
    url
  };
}

// src/typeschema/core/binding.ts
function extractValueSetConceptsByUrl(register, pkg, valueSetUrl, logger) {
  const cleanUrl = dropVersionFromUrl(valueSetUrl) || valueSetUrl;
  const valueSet = register.resolveVs(pkg, cleanUrl);
  if (!valueSet) return void 0;
  return extractValueSetConcepts(register, valueSet);
}
function extractValueSetConcepts(register, valueSet, _logger) {
  if (valueSet.expansion?.contains) {
    return valueSet.expansion.contains.filter((item) => item.code !== void 0).map((item) => {
      assert4(item.code);
      return {
        code: item.code,
        display: item.display,
        system: item.system
      };
    });
  }
  const concepts = [];
  if (valueSet.compose?.include) {
    for (const include of valueSet.compose.include) {
      if (include.concept) {
        for (const concept of include.concept) {
          concepts.push({
            system: include.system,
            code: concept.code,
            display: concept.display
          });
        }
      } else if (include.system && !include.filter) {
        try {
          const codeSystem = register.resolveAny(include.system);
          if (codeSystem?.concept) {
            const extractConcepts = (conceptList, system) => {
              for (const concept of conceptList) {
                concepts.push({
                  system,
                  code: concept.code,
                  display: concept.display
                });
                if (concept.concept) {
                  extractConcepts(concept.concept, system);
                }
              }
            };
            extractConcepts(codeSystem.concept, include.system);
          }
        } catch {
        }
      }
    }
  }
  return concepts.length > 0 ? concepts : void 0;
}
var MAX_ENUM_LENGTH = 100;
var PLACEHOLDER_ONLY_ENUM_CODES = /* @__PURE__ */ new Set(["UNK"]);
var BINDABLE_TYPES = /* @__PURE__ */ new Set([
  "code",
  "Coding",
  "CodeableConcept",
  "CodeableReference",
  "Quantity",
  "string",
  "uri",
  "Duration"
]);
function buildEnum(register, fhirSchema, element, logger) {
  if (!element.binding) return void 0;
  const strength = element.binding.strength;
  const valueSetUrl = element.binding.valueSet;
  if (!valueSetUrl) return void 0;
  if (!BINDABLE_TYPES.has(element.type ?? "")) {
    logger?.dryWarn(
      "#binding",
      `eld-11: Binding on non-bindable type '${element.type}' (valueSet: ${valueSetUrl})`
    );
    return void 0;
  }
  const shouldGenerateEnum = strength === "required" || strength === "extensible" || strength === "preferred";
  if (!shouldGenerateEnum) return void 0;
  const concepts = extractValueSetConceptsByUrl(register, fhirSchema.package_meta, valueSetUrl);
  if (!concepts || concepts.length === 0) return void 0;
  const codes = concepts.map((c) => c.code).filter((code) => code && typeof code === "string" && code.trim().length > 0);
  const onlyCode = codes.length === 1 ? codes[0] : void 0;
  if (onlyCode && PLACEHOLDER_ONLY_ENUM_CODES.has(onlyCode)) {
    logger?.dryWarn(
      "#placeholderValueSet",
      `Value set ${valueSetUrl} only expands to placeholder code '${onlyCode}'; skipping enum generation.`
    );
    return void 0;
  }
  if (codes.length > MAX_ENUM_LENGTH) {
    logger?.dryWarn(
      "#largeValueSet",
      `Value set ${valueSetUrl} has ${codes.length} which is more than ${MAX_ENUM_LENGTH} codes, which may cause issues with code generation.`
    );
    return void 0;
  }
  if (codes.length === 0) return void 0;
  return { isOpen: strength !== "required", values: codes };
}
function generateBindingSchema(register, fhirSchema, path, element, logger) {
  if (!element.binding?.valueSet) return void 0;
  const identifier = mkBindingIdentifier(fhirSchema, path, element);
  const valueSetIdentifier = mkValueSetIdentifierByUrl(
    register,
    fhirSchema.package_meta,
    element.binding.valueSet
  );
  const enumResult = buildEnum(register, fhirSchema, element, logger);
  return {
    identifier,
    valueset: valueSetIdentifier,
    strength: element.binding.strength,
    enum: enumResult,
    dependencies: [valueSetIdentifier]
  };
}
function collectBindingSchemas(register, fhirSchema, logger) {
  const processedPaths = /* @__PURE__ */ new Set();
  if (!fhirSchema.elements) return [];
  const bindings = [];
  function collectBindings(elements, parentPath) {
    for (const [key, element] of Object.entries(elements)) {
      const path = [...parentPath, key];
      const pathKey = path.join(".");
      const elemSnapshot = register.resolveElementSnapshot(fhirSchema, path);
      if (processedPaths.has(pathKey)) continue;
      processedPaths.add(pathKey);
      if (elemSnapshot.binding) {
        const binding = generateBindingSchema(register, fhirSchema, path, elemSnapshot, logger);
        if (binding) {
          bindings.push(binding);
        }
      }
      if (element.elements) {
        collectBindings(element.elements, path);
      }
    }
  }
  collectBindings(fhirSchema.elements, []);
  bindings.sort((a, b) => a.identifier.name.localeCompare(b.identifier.name));
  const uniqueBindings = [];
  const seenUrls = /* @__PURE__ */ new Set();
  for (const binding of bindings) {
    if (!seenUrls.has(binding.identifier.url)) {
      seenUrls.add(binding.identifier.url);
      uniqueBindings.push(binding);
    }
  }
  return uniqueBindings;
}

// src/typeschema/core/name-candidates.ts
var normalizeName = (s) => {
  const cleaned = s.replace(/\[x\]/g, "").replace(/[- :.]/g, "_");
  if (!cleaned) return "";
  return uppercaseFirstLetter(cleaned);
};
var normalizeCamelName = (s) => {
  const cleaned = s.replace(/\[x\]/g, "").replace(/:/g, "_");
  if (!cleaned) return "";
  return uppercaseFirstLetter(camelCase(cleaned));
};
var extensionCandidates = (name, path) => {
  const base = normalizeCamelName(name) || "Extension";
  const pathParts = path.split(".").filter((p) => p && p !== "extension").join("_");
  const pathPart = pathParts ? normalizeCamelName(pathParts) : "";
  const qualified = `${pathPart}${base}`;
  return [base, qualified, `${qualified}Extension`];
};
var sliceCandidates = (fieldName, sliceName) => {
  const base = normalizeName(sliceName) || "Slice";
  const fieldPart = normalizeCamelName(fieldName) || "Field";
  const qualified = `${fieldPart}${base}`;
  return [base, qualified, `${qualified}Slice`];
};
var countBy = (entries, level, reserved) => entries.reduce(
  (counts, e) => {
    const name = e.candidates[level] ?? "";
    counts[name] = (counts[name] ?? 0) + 1;
    if (reserved.has(name)) counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  },
  {}
);
var resolveNameCollisions = (entries, reserved) => {
  const levels = entries[0]?.candidates.length ?? 0;
  const resolve6 = (unresolved, level) => {
    if (unresolved.length === 0 || level >= levels) return {};
    const counts = countBy(unresolved, level, reserved);
    const isLastLevel = level >= levels - 1;
    const [resolved, colliding] = unresolved.reduce(
      ([res, col], e) => {
        const name = e.candidates[level] ?? "";
        return (counts[name] ?? 0) > 1 && !isLastLevel ? [res, [...col, e]] : [{ ...res, [e.key]: name }, col];
      },
      [{}, []]
    );
    return { ...resolved, ...resolve6(colliding, level + 1) };
  };
  return resolve6(entries, 0);
};
var mkExtensionNameCandidates = (ext) => {
  return { candidates: extensionCandidates(ext.name, ext.path), recommended: "" };
};
var mkSliceNameCandidates = (fieldName, sliceName) => {
  return { candidates: sliceCandidates(fieldName, sliceName), recommended: "" };
};
var assignRecommendedBaseNames = (profile) => {
  const extensionEntries = (profile.extensions ?? []).filter((ext) => ext.url).map((ext) => ({
    key: `ext:${ext.url}:${ext.path}`,
    candidates: ext.nameCandidates.candidates
  }));
  const sliceEntries = Object.entries(profile.fields ?? {}).flatMap(([fieldName, field]) => {
    if (!("slicing" in field) || !field.slicing?.slices) return [];
    return Object.entries(field.slicing.slices).map(([sliceName, slice]) => ({
      key: `slice:${fieldName}:${sliceName}`,
      candidates: slice.nameCandidates.candidates
    }));
  });
  const reservedNames = new Set(Object.keys(profile.fields ?? {}).map(normalizeCamelName));
  const allEntries = [...extensionEntries, ...sliceEntries];
  if (allEntries.length === 0) return;
  const resolved = resolveNameCollisions(allEntries, reservedNames);
  for (const ext of profile.extensions ?? []) {
    if (!ext.url) continue;
    const key = `ext:${ext.url}:${ext.path}`;
    if (resolved[key]) ext.nameCandidates.recommended = resolved[key];
  }
  for (const [fieldName, field] of Object.entries(profile.fields ?? {})) {
    if (!("slicing" in field) || !field.slicing?.slices) continue;
    for (const [sliceName, slice] of Object.entries(field.slicing.slices)) {
      const key = `slice:${fieldName}:${sliceName}`;
      if (resolved[key]) slice.nameCandidates.recommended = resolved[key];
    }
  }
};

// src/fhir-types/hl7-fhir-r4-core/CodeSystem.ts
var isCodeSystem = (resource) => {
  return resource !== null && typeof resource === "object" && resource.resourceType === "CodeSystem";
};

// src/fhir-types/hl7-fhir-r4-core/ValueSet.ts
var isValueSet = (resource) => {
  return resource !== null && typeof resource === "object" && resource.resourceType === "ValueSet";
};

// src/typeschema/register.ts
var BARE_RESOURCE_NAME_RE = /^[a-zA-Z0-9]+$/;
var readPackageDependencies = async (manager, packageMeta2) => {
  const packageJSON = await manager.packageJson(packageMeta2.name);
  if (!packageJSON) return [];
  const dependencies = packageJSON.dependencies;
  if (dependencies !== void 0) {
    return Object.entries(dependencies).map(([name, version]) => {
      return { name, version };
    });
  }
  return [];
};
var mkEmptyPkgIndex = (pkg) => {
  return {
    pkg,
    canonicalResolution: {},
    fhirSchemas: {},
    valueSets: {}
  };
};
var mkPackageAwareResolver = async (manager, pkg, deep, acc, logger, nodeModulesPath) => {
  const pkgId = packageMetaToFhir(pkg);
  logger?.info(`${" ".repeat(deep * 2)}+ ${pkgId}`);
  if (acc[pkgId]) return acc[pkgId];
  const index = mkEmptyPkgIndex(pkg);
  acc[pkgId] = index;
  let resources = await manager.search({ package: pkg });
  if (resources.length === 0 && nodeModulesPath) {
    resources = await scanNodeModulesPackage(nodeModulesPath, pkg, logger);
  }
  for (const resource of resources) {
    const rawUrl = resource.url;
    if (!rawUrl) continue;
    if (!(isStructureDefinition(resource) || isValueSet(resource) || isCodeSystem(resource))) continue;
    const url = rawUrl;
    if (index.canonicalResolution[url])
      logger?.dryWarn("#duplicateCanonical", `Duplicate canonical URL: ${url} at ${pkgId}.`);
    index.canonicalResolution[url] = [{ deep, pkg, pkgId, resource }];
  }
  const deps = await readPackageDependencies(manager, pkg);
  for (const depPkg of deps) {
    const { canonicalResolution } = await mkPackageAwareResolver(
      manager,
      depPkg,
      deep + 1,
      acc,
      logger,
      nodeModulesPath
    );
    for (const [surl, resolutions] of Object.entries(canonicalResolution)) {
      const url = surl;
      index.canonicalResolution[url] = [...index.canonicalResolution[url] || [], ...resolutions];
    }
  }
  for (const resolutionOptions of Object.values(index.canonicalResolution)) {
    resolutionOptions.sort((a, b) => a.deep - b.deep);
  }
  return index;
};
var enrichResolver = (resolver, logger) => {
  for (const { pkg, canonicalResolution } of Object.values(resolver)) {
    const pkgId = packageMetaToFhir(pkg);
    if (!resolver[pkgId]) throw new Error(`Package ${pkgId} not found`);
    let counter = 0;
    logger?.info(`FHIR Schema conversion for '${packageMetaToFhir(pkg)}' begins...`);
    for (const [_url, options] of Object.entries(canonicalResolution)) {
      const resolition = options[0];
      if (!resolition) throw new Error(`Resource not found`);
      const resource = resolition.resource;
      const resourcePkg = resolition.pkg;
      if (isStructureDefinition(resource)) {
        const fs6 = fhirschema.translate(resource);
        const rfs = enrichFHIRSchema(fs6, resourcePkg);
        counter++;
        resolver[pkgId].fhirSchemas[rfs.url] = rfs;
      }
      if (isValueSet(resource)) {
        const rvs = enrichValueSet(resource, resourcePkg);
        resolver[pkgId].valueSets[rvs.url] = rvs;
      }
    }
    logger?.info(`FHIR Schema conversion for '${packageMetaToFhir(pkg)}' completed: ${counter} successful`);
  }
};
var packageAgnosticResolveCanonical = (resolver, url, _logger) => {
  const options = Object.values(resolver).flatMap((pkg) => pkg.canonicalResolution[url]);
  if (!options) throw new Error(`No canonical resolution found for ${url} in any package`);
  return options[0]?.resource;
};
var registerFromManager = async (manager, { logger, focusedPackages, nodeModulesPath }) => {
  const packages = focusedPackages ?? await manager.packages();
  if (!nodeModulesPath && focusedPackages) {
    const pkgNames = focusedPackages.map(packageMetaToNpm);
    nodeModulesPath = computeNodeModulesPath(pkgNames, CANONICAL_MANAGER_WORKING_DIR);
  }
  const resolver = {};
  for (const pkg of packages) {
    await mkPackageAwareResolver(manager, pkg, 0, resolver, logger, nodeModulesPath);
  }
  enrichResolver(resolver, logger);
  const resolveFs = (pkg, canonicalUrl) => {
    const pkgIndex = resolver[packageMetaToFhir(pkg)];
    if (pkgIndex) {
      const resolution = pkgIndex.canonicalResolution[canonicalUrl]?.[0];
      if (resolution) {
        return resolver[resolution.pkgId]?.fhirSchemas[canonicalUrl];
      }
    }
    for (const idx of Object.values(resolver)) {
      const fs6 = idx.fhirSchemas[canonicalUrl];
      if (fs6 && fs6.package_meta.name === pkg.name) return fs6;
    }
    for (const idx of Object.values(resolver)) {
      const fs6 = idx.fhirSchemas[canonicalUrl];
      if (fs6) return fs6;
    }
    return void 0;
  };
  const resolveVs = (pkg, canonicalUrl) => {
    const pkgIndex = resolver[packageMetaToFhir(pkg)];
    if (pkgIndex) {
      const resolution = pkgIndex.canonicalResolution[canonicalUrl]?.[0];
      if (resolution) {
        return resolver[resolution.pkgId]?.valueSets[canonicalUrl];
      }
    }
    for (const idx of Object.values(resolver)) {
      const vs = idx.valueSets[canonicalUrl];
      if (vs && vs.package_meta.name === pkg.name) return vs;
    }
    for (const idx of Object.values(resolver)) {
      const vs = idx.valueSets[canonicalUrl];
      if (vs) return vs;
    }
    return void 0;
  };
  const ensureSpecializationCanonicalUrl = (name) => {
    if (name.includes("|")) name = name.split("|")[0];
    if (BARE_RESOURCE_NAME_RE.test(name)) {
      return `http://hl7.org/fhir/StructureDefinition/${name}`;
    }
    return name;
  };
  const resolveFsGenealogy = (pkg, canonicalUrl) => {
    let fs6 = resolveFs(pkg, canonicalUrl);
    if (fs6 === void 0) throw new Error(`Failed to resolve FHIR Schema: '${canonicalUrl}'`);
    const genealogy = [fs6];
    while (fs6?.base) {
      const pkg2 = fs6.package_meta;
      const baseUrl = ensureSpecializationCanonicalUrl(fs6.base);
      fs6 = resolveFs(pkg2, baseUrl);
      if (fs6 === void 0)
        throw new Error(
          `Failed to resolve FHIR Schema base for '${canonicalUrl}'. Problem: '${baseUrl}' from '${packageMetaToFhir(pkg2)}'`
        );
      genealogy.push(fs6);
    }
    return genealogy;
  };
  const resolveFsSpecializations = (pkg, canonicalUrl) => {
    return resolveFsGenealogy(pkg, canonicalUrl).filter((fs6) => fs6.derivation === "specialization");
  };
  const resolveElementSnapshot = (fhirSchema, path) => {
    const geneology = resolveFsGenealogy(fhirSchema.package_meta, fhirSchema.url);
    const elemGeneology = resolveFsElementGenealogy(geneology, path);
    const elemSnapshot = mergeFsElementProps(elemGeneology);
    return elemSnapshot;
  };
  const getAllElementKeys = (elems) => {
    const keys = /* @__PURE__ */ new Set();
    for (const [key, elem] of Object.entries(elems)) {
      keys.add(key);
      for (const choiceKey of elem?.choices || []) {
        if (!elems[choiceKey]) {
          keys.add(choiceKey);
        }
      }
    }
    return Array.from(keys);
  };
  let cachedResolutionTree;
  return {
    testAppendFs(rfs) {
      const pkgId = packageMetaToFhir(rfs.package_meta);
      if (!resolver[pkgId]) resolver[pkgId] = mkEmptyPkgIndex(rfs.package_meta);
      resolver[pkgId].fhirSchemas[rfs.url] = rfs;
      cachedResolutionTree = void 0;
    },
    resolveFs,
    resolveFsGenealogy,
    resolveFsSpecializations,
    ensureSpecializationCanonicalUrl,
    resolveSd: (pkg, canonicalUrl) => {
      const res = resolver[packageMetaToFhir(pkg)]?.canonicalResolution[canonicalUrl]?.[0]?.resource;
      if (isStructureDefinition(res)) return res;
      return void 0;
    },
    allSd: () => Object.values(resolver).flatMap(
      (pkgIndex) => Object.values(pkgIndex.canonicalResolution).flatMap(
        (resolutions) => resolutions.map((r) => {
          const sd = r.resource;
          if (!sd.package_name) {
            return {
              ...sd,
              package_name: r.pkg.name,
              package_version: r.pkg.version
            };
          }
          return sd;
        })
      )
    ).filter((r) => isStructureDefinition(r)).sort((sd1, sd2) => sd1.url.localeCompare(sd2.url)),
    allFs: () => Object.values(resolver).flatMap((pkgIndex) => Object.values(pkgIndex.fhirSchemas)),
    allVs: () => Object.values(resolver).flatMap((pkgIndex) => Object.values(pkgIndex.valueSets)),
    resolveVs,
    resolveAny: (canonicalUrl) => packageAgnosticResolveCanonical(resolver, canonicalUrl),
    resolveElementSnapshot,
    getAllElementKeys,
    resolver,
    resolutionTree: () => {
      if (cachedResolutionTree) return cachedResolutionTree;
      const res = {};
      for (const [_pkgId, pkgIndex] of Object.entries(resolver)) {
        const pkgName = pkgIndex.pkg.name;
        res[pkgName] = {};
        for (const [surl, resolutions] of Object.entries(pkgIndex.canonicalResolution)) {
          const url = surl;
          res[pkgName][url] = [];
          for (const resolution of resolutions) {
            res[pkgName][url].push({ deep: resolution.deep, pkg: resolution.pkg });
          }
        }
      }
      cachedResolutionTree = res;
      return res;
    }
  };
};
var computeCanonicalManagerCacheKey = (packageNames) => {
  const content = JSON.stringify([...packageNames].sort());
  return createHash("sha256").update(content).digest("hex");
};
var computeNodeModulesPath = (packageNames, workingDir) => {
  const cacheKey = computeCanonicalManagerCacheKey(packageNames);
  return join(process.cwd(), workingDir, cacheKey, "node", "node_modules");
};
var readPackageDirVersion = async (pkgDir) => {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return void 0;
  try {
    const content = await readFile(pkgJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    return typeof parsed.version === "string" ? parsed.version : void 0;
  } catch {
    return void 0;
  }
};
var scanNodeModulesPackageDir = async (pkgDir, pkg, logger) => {
  const resources = [];
  let fileNames;
  try {
    fileNames = await readdir(pkgDir);
  } catch (err) {
    logger?.dryWarn(
      "#canonicalManagerFallback",
      `Failed to read directory for ${packageMetaToFhir(pkg)} at ${pkgDir}: ${err}`
    );
    return [];
  }
  for (const name of fileNames) {
    if (!name.endsWith(".json")) continue;
    if (name === "package.json" || name === ".index.json") continue;
    try {
      const content = await readFile(join(pkgDir, name), "utf-8");
      const resource = JSON.parse(content);
      if (!resource.resourceType || !resource.url) continue;
      if (!(isStructureDefinition(resource) || isValueSet(resource) || isCodeSystem(resource))) continue;
      resources.push(resource);
    } catch (err) {
      logger?.dryWarn("#canonicalManagerFallback", `Skipping ${name} in ${packageMetaToFhir(pkg)}: ${err}`);
    }
  }
  return resources;
};
var findCandidateNodeModulesPaths = (computedPath) => {
  const candidates = [];
  if (existsSync(computedPath)) candidates.push(computedPath);
  const cacheRoot = join(computedPath, "..", "..", "..");
  if (!existsSync(cacheRoot)) return candidates;
  let entries;
  try {
    entries = __require("fs").readdirSync(cacheRoot);
  } catch {
    return candidates;
  }
  for (const entry of entries) {
    const candidate = join(cacheRoot, entry, "node", "node_modules");
    if (candidate === computedPath) continue;
    if (existsSync(candidate)) candidates.push(candidate);
  }
  return candidates;
};
var scanNodeModulesPackage = async (nodeModulesPath, pkg, logger) => {
  const candidatePaths = findCandidateNodeModulesPaths(nodeModulesPath);
  if (candidatePaths.length === 0) return [];
  let chosenDir;
  let chosenSource = "";
  let chosenFlatVersion;
  outer: for (const candidate of candidatePaths) {
    const flatPkgDir = join(candidate, pkg.name);
    if (!existsSync(flatPkgDir)) continue;
    const flatVersion = await readPackageDirVersion(flatPkgDir);
    if (flatVersion === pkg.version) {
      chosenDir = flatPkgDir;
      chosenSource = candidate === nodeModulesPath ? "flat" : `flat (sibling-cache)`;
      chosenFlatVersion = flatVersion;
      break;
    }
    let parentDirNames;
    try {
      parentDirNames = await readdir(candidate);
    } catch {
      parentDirNames = [];
    }
    for (const parentDir of parentDirNames) {
      const nestedPkgDir = join(candidate, parentDir, "node_modules", pkg.name);
      if (!existsSync(nestedPkgDir)) continue;
      const nestedVersion = await readPackageDirVersion(nestedPkgDir);
      if (nestedVersion === pkg.version) {
        chosenDir = nestedPkgDir;
        chosenSource = `nested (${parentDir}/node_modules/${pkg.name}${candidate === nodeModulesPath ? "" : ", sibling-cache"})`;
        chosenFlatVersion = flatVersion;
        break outer;
      }
    }
    if (!chosenDir) {
      chosenDir = flatPkgDir;
      chosenSource = `flat path (version mismatch: flat=${flatVersion ?? "unknown"}, requested=${pkg.version})`;
      chosenFlatVersion = flatVersion;
    }
  }
  if (!chosenDir) return [];
  const resources = await scanNodeModulesPackageDir(chosenDir, pkg, logger);
  if (resources.length > 0) {
    logger?.warn(
      "#canonicalManagerFallback",
      `Package ${packageMetaToFhir(pkg)} had 0 resources in canonical manager (likely due to invalid .index.json entries or addTgzPackage cache mismatch). Falling back to direct directory scan (${chosenSource}, flat-version=${chosenFlatVersion ?? "unknown"}): ${resources.length} resources found.`
    );
  }
  return resources;
};
var CANONICAL_MANAGER_WORKING_DIR = ".codegen-cache/canonical-manager-cache";
var registerFromPackageMetas = async (packageMetas, conf) => {
  const packageNames = packageMetas.map(packageMetaToNpm);
  conf?.logger?.info(`Loading FHIR packages: ${packageNames.join(", ")}`);
  const manager = CanonicalManager({
    packages: packageNames,
    workingDir: CANONICAL_MANAGER_WORKING_DIR,
    registry: conf.registry || void 0
  });
  await manager.init();
  return await registerFromManager(manager, {
    ...conf,
    focusedPackages: packageMetas,
    // Provide nodeModulesPath explicitly so registerFromManager doesn't have to
    // recompute it from focusedPackages (both produce the same result here).
    nodeModulesPath: computeNodeModulesPath(packageNames, CANONICAL_MANAGER_WORKING_DIR)
  });
};
var resolveFsElementGenealogy = (genealogy, path) => {
  const [top, ...rest] = path;
  if (top === void 0) return [];
  return genealogy.map((fs6) => {
    if (!fs6.elements) return void 0;
    let elem = fs6.elements?.[top];
    for (const k of rest) {
      elem = elem?.elements?.[k];
    }
    return elem;
  }).filter((elem) => elem !== void 0);
};
function mergeFsElementProps(genealogy) {
  const revGenealogy = genealogy.reverse();
  const snapshot = Object.assign({}, ...revGenealogy);
  snapshot.elements = void 0;
  return snapshot;
}

// src/typeschema/core/nested-types.ts
var hasStructuralElements = (register, fhirSchema, path) => {
  const specializations = register.resolveFsSpecializations(fhirSchema.package_meta, fhirSchema.url);
  const elemGens = resolveFsElementGenealogy(specializations, path);
  const elemType = mergeFsElementProps(elemGens).type;
  let typeKeys;
  if (elemType) {
    const typeUrl = register.ensureSpecializationCanonicalUrl(elemType);
    const typeGenealogy = register.resolveFsGenealogy(fhirSchema.package_meta, typeUrl);
    const keys = typeGenealogy.flatMap((fs6) => Object.keys(fs6.elements ?? {}));
    if (keys.length > 0) typeKeys = new Set(keys);
  }
  for (const elem of elemGens) {
    if (!elem.elements || Object.keys(elem.elements).length === 0) continue;
    if (typeKeys && !Object.keys(elem.elements).some((k) => !typeKeys.has(k))) continue;
    return true;
  }
  return false;
};
var isNestedElement = (register, fhirSchema, path, snapshot, raw) => {
  if (snapshot.type === "BackboneElement") return true;
  if (!raw?.elements || raw.choiceOf !== void 0) return false;
  return hasStructuralElements(register, fhirSchema, path);
};
var collectNestedPaths = (fs6) => {
  if (!fs6.elements) return /* @__PURE__ */ new Set();
  return new Set(
    collectNestedElements(fs6, [], fs6.elements).filter(([_, el]) => el.elements && Object.keys(el.elements).length > 0).map(([path]) => path.join("."))
  );
};
function mkNestedIdentifier(register, fhirSchema, path) {
  const nestedTypeOrigins = {};
  const genealogy = fhirSchema.derivation === "constraint" ? register.resolveFsSpecializations(fhirSchema.package_meta, fhirSchema.url) : register.resolveFsGenealogy(fhirSchema.package_meta, fhirSchema.url);
  for (const fs6 of [...genealogy].reverse()) {
    const paths = collectNestedPaths(fs6);
    for (const p of paths) {
      nestedTypeOrigins[p] = `${fs6.url}#${p}`;
    }
  }
  const nestedName = path.join(".");
  const url = nestedTypeOrigins[nestedName] ?? `${fhirSchema.url}#${nestedName}`;
  const baseUrl = url.split("#")[0];
  const baseFs = register.resolveFs(fhirSchema.package_meta, baseUrl);
  const packageMeta2 = baseFs?.package_meta ?? fhirSchema.package_meta;
  return {
    kind: "nested",
    package: packageMeta2.name,
    version: packageMeta2.version,
    name: nestedName,
    url
  };
}
function collectNestedElements(fhirSchema, parentPath, elements) {
  const nested = [];
  for (const [key, element] of Object.entries(elements)) {
    const path = [...parentPath, key];
    if (element.elements && element.choiceOf === void 0) nested.push([path, element]);
    if (element.elements) nested.push(...collectNestedElements(fhirSchema, path, element.elements));
  }
  return nested;
}
function transformNestedElements(register, fhirSchema, parentPath, elements, logger) {
  const fields = {};
  const genealogy = register.resolveFsGenealogy(fhirSchema.package_meta, fhirSchema.url);
  const elemGenealogy = resolveFsElementGenealogy(genealogy, parentPath);
  const allKeys = /* @__PURE__ */ new Set();
  for (const elem of elemGenealogy) {
    if (elem.elements) {
      for (const k of Object.keys(elem.elements)) {
        allKeys.add(k);
      }
    }
  }
  for (const key of allKeys) {
    const path = [...parentPath, key];
    const elemSnapshot = register.resolveElementSnapshot(fhirSchema, path);
    if (isNestedElement(register, fhirSchema, path, elemSnapshot, elements[key])) {
      fields[key] = mkNestedField(register, fhirSchema, path, elemSnapshot);
    } else {
      fields[key] = mkField(register, fhirSchema, path, elemSnapshot, logger);
    }
  }
  return fields;
}
function mkNestedTypes(register, fhirSchema, logger) {
  if (!fhirSchema.elements) return void 0;
  const nested = collectNestedElements(fhirSchema, [], fhirSchema.elements).filter(([path, element]) => {
    if (!element.elements || Object.keys(element.elements).length === 0) return false;
    if (element.type !== "BackboneElement") {
      return hasStructuralElements(register, fhirSchema, path);
    }
    return true;
  });
  const nestedTypes = [];
  for (const [path, element] of nested) {
    const identifier = mkNestedIdentifier(register, fhirSchema, path);
    let baseName;
    if (element.type === "BackboneElement" || !element.type) {
      baseName = "BackboneElement";
    } else {
      baseName = element.type;
    }
    const baseUrl = register.ensureSpecializationCanonicalUrl(baseName);
    const baseFs = register.resolveFs(fhirSchema.package_meta, baseUrl);
    if (!baseFs) throw new Error(`Could not resolve base type ${baseName}`);
    const base = {
      kind: "complex-type",
      package: baseFs.package_meta.name,
      version: baseFs.package_meta.version,
      name: baseName,
      url: baseUrl
    };
    const fields = transformNestedElements(register, fhirSchema, path, element.elements ?? {}, logger);
    const nestedType = {
      identifier,
      base,
      fields
    };
    nestedTypes.push(nestedType);
  }
  nestedTypes.sort((a, b) => a.identifier.url.localeCompare(b.identifier.url));
  return nestedTypes.length === 0 ? void 0 : nestedTypes;
}
function extractNestedDependencies(nestedTypes) {
  const deps = [];
  for (const nested of nestedTypes) {
    if (nested.base) {
      deps.push(nested.base);
    }
    for (const field of Object.values(nested.fields || {})) {
      if ("type" in field && field.type) {
        deps.push(field.type);
      }
      if ("binding" in field && field.binding) {
        deps.push(field.binding);
      }
    }
  }
  return deps;
}

// src/typeschema/core/field-builder.ts
var R5_ONLY_TYPES = /* @__PURE__ */ new Set([
  "Availability",
  "CodeableReference",
  "ExtendedContactDetail",
  "MonetaryComponent",
  "RatioRange",
  "VirtualServiceDetail"
]);
var dependsOnR4Core = (register, pkg) => {
  const pkgIndex = register.resolver[packageMetaToFhir(pkg)];
  if (!pkgIndex) return false;
  for (const options of Object.values(pkgIndex.canonicalResolution)) {
    for (const opt of options) {
      if (opt.pkg.name === "hl7.fhir.r4.core") return true;
    }
  }
  return false;
};
var fieldTypeResolutionHint = (register, pkg, type) => {
  if (!R5_ONLY_TYPES.has(type)) return "";
  if (!dependsOnR4Core(register, pkg)) return "";
  return `
  hint:    '${type}' is an R5+ type and is not available when generating against R4.
           Either skip this canonical via skip-hack.ts, or upgrade the target to R5.`;
};
function isRequired(register, fhirSchema, path) {
  const fieldName = path[path.length - 1];
  if (!fieldName) throw new Error(`Internal error: fieldName is missing for path ${path.join("/")}`);
  const parentPath = path.slice(0, -1);
  const requires = register.resolveFsGenealogy(fhirSchema.package_meta, fhirSchema.url).flatMap((fs6) => {
    if (parentPath.length === 0) return fs6.required || [];
    if (!fs6.elements) return [];
    let elem = fs6;
    for (const k of parentPath) {
      elem = elem?.elements?.[k];
    }
    return elem?.required || [];
  });
  return new Set(requires).has(fieldName);
}
function isExcluded(register, fhirSchema, path) {
  const fieldName = path[path.length - 1];
  if (!fieldName) throw new Error(`Internal error: fieldName is missing for path ${path.join("/")}`);
  const parentPath = path.slice(0, -1);
  const requires = register.resolveFsGenealogy(fhirSchema.package_meta, fhirSchema.url).flatMap((fs6) => {
    if (parentPath.length === 0) return fs6.excluded || [];
    if (!fs6.elements) return [];
    let elem = fs6;
    for (const k of parentPath) {
      elem = elem?.elements?.[k];
    }
    return elem?.excluded || [];
  });
  return new Set(requires).has(fieldName);
}
var buildReferences = (register, fhirSchema, element) => {
  if (!element.refers) return void 0;
  const resource = [];
  const profiles = [];
  const seen = /* @__PURE__ */ new Set();
  for (const ref of element.refers) {
    const curl = register.ensureSpecializationCanonicalUrl(ref);
    const fs6 = register.resolveFs(fhirSchema.package_meta, curl);
    if (!fs6) throw new Error(`Failed to resolve fs for ${curl}`);
    const id = mkIdentifier(fs6);
    let resolved = id;
    if (isProfileIdentifier(id)) {
      profiles.push(id);
      const baseFs = register.resolveFsSpecializations(fs6.package_meta, fs6.url)[0];
      if (!baseFs) throw new Error(`Failed to resolve base specialization for ${curl}`);
      resolved = mkIdentifier(baseFs);
    }
    if (!seen.has(resolved.url)) {
      seen.add(resolved.url);
      resource.push(resolved);
    }
  }
  return { resource, profiles: profiles.length > 0 ? profiles : void 0 };
};
var extractSliceFieldNames = (schema) => {
  const required = /* @__PURE__ */ new Set();
  const excluded = /* @__PURE__ */ new Set();
  if (schema.required) {
    for (const name of schema.required) required.add(name);
  }
  if (schema.excluded) {
    for (const name of schema.excluded) excluded.add(name);
  }
  if (schema.elements) {
    for (const [name, element] of Object.entries(schema.elements)) {
      if (element.min !== void 0 && element.min > 0) {
        required.add(name);
      }
    }
  }
  const elements = schema.elements ? Object.keys(schema.elements) : void 0;
  return {
    required: required.size > 0 ? Array.from(required) : void 0,
    excluded: excluded.size > 0 ? Array.from(excluded) : void 0,
    elements: elements && elements.length > 0 ? elements : void 0
  };
};
var isEmptyMatch = (match) => {
  if (!match) return true;
  if (typeof match === "object" && Object.keys(match).length === 0) return true;
  return false;
};
var setNestedValue = (obj, path, value) => {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  const lastKey = path[path.length - 1];
  current[lastKey] = value;
};
var navigateMatch = (match, remainingPath) => {
  let value = match;
  for (const seg of remainingPath) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      value = value[seg];
    } else {
      return void 0;
    }
  }
  return value;
};
var collectDiscriminatorValue = (schema, segments, index, result, arrayPaths) => {
  if (index >= segments.length || !schema.elements) return;
  const segment = segments[index];
  const element = schema.elements[segment];
  if (!element) return;
  if (index === segments.length - 1 && element.fixed?.value !== void 0) {
    setNestedValue(result, segments, element.fixed.value);
    return;
  }
  if (element.slicing?.slices) {
    arrayPaths.add(segments.slice(0, index + 1).join("."));
    const remainingSegments = segments.slice(index + 1);
    for (const subSlice of Object.values(element.slicing.slices)) {
      if (!subSlice.min || subSlice.min < 1 || !subSlice.match || typeof subSlice.match !== "object") continue;
      const match = subSlice.match;
      if (Object.keys(match).length === 0) continue;
      if (remainingSegments.length > 0) {
        const value = navigateMatch(match, remainingSegments);
        if (value !== void 0) setNestedValue(result, segments, value);
      } else {
        setNestedValue(result, segments.slice(0, index + 1), match);
      }
    }
    return;
  }
  collectDiscriminatorValue(element, segments, index + 1, result, arrayPaths);
};
var computeTypeDiscriminatorMatch = (path, schema, result) => {
  if (path === "$this") return;
  const segments = path.split(".");
  let elem = schema;
  for (const seg of segments) {
    elem = elem?.elements?.[seg];
    if (!elem) return;
  }
  const typeName = elem.type;
  if (!typeName || typeName.includes("/")) return;
  setNestedValue(result, segments, { resourceType: typeName });
};
var computeMatchFromSchema = (discriminators, schema) => {
  if (!schema || !discriminators || discriminators.length === 0) return void 0;
  const result = {};
  const arrayPaths = /* @__PURE__ */ new Set();
  for (const disc of discriminators) {
    if (disc.type === "type") {
      computeTypeDiscriminatorMatch(disc.path, schema, result);
    } else {
      if (!schema.elements) continue;
      const segments = disc.path.split(".");
      collectDiscriminatorValue(schema, segments, 0, result, arrayPaths);
    }
  }
  if (Object.keys(result).length === 0) return void 0;
  for (const path of arrayPaths) {
    const segments = path.split(".");
    let target = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const v = target[segments[i]];
      if (!v || typeof v !== "object" || Array.isArray(v)) break;
      target = v;
    }
    const key = segments[segments.length - 1];
    if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      target[key] = [target[key]];
    }
  }
  return result;
};
var buildSlicing = (fieldName, element) => {
  const slicing = element.slicing;
  if (!slicing) return void 0;
  const slices = {};
  for (const [name, slice] of Object.entries(slicing.slices ?? {})) {
    if (!slice) continue;
    const { required, excluded, elements } = slice.schema ? extractSliceFieldNames(slice.schema) : {};
    slices[name] = {
      min: slice.min,
      max: slice.max,
      match: isEmptyMatch(slice.match) ? computeMatchFromSchema(slicing.discriminator ?? [], slice.schema) : slice.match,
      required,
      excluded,
      elements,
      nameCandidates: mkSliceNameCandidates(fieldName, name)
    };
  }
  return {
    discriminator: slicing.discriminator ?? [],
    rules: slicing.rules,
    ordered: slicing.ordered,
    slices: Object.keys(slices).length > 0 ? slices : void 0
  };
};
function buildFieldType(register, fhirSchema, path, element, logger) {
  if (element.elementReference) {
    const refPath = element.elementReference.slice(1).filter((_, i) => i % 2 === 1);
    return mkNestedIdentifier(register, fhirSchema, refPath);
  }
  if (element.type) {
    const url = register.ensureSpecializationCanonicalUrl(element.type);
    const fieldFs = register.resolveFs(fhirSchema.package_meta, url);
    if (!fieldFs) {
      const pkgId = packageMetaToFhir(fhirSchema.package_meta);
      const fieldPath = path.join(".");
      const hint = fieldTypeResolutionHint(register, fhirSchema.package_meta, element.type);
      throw new Error(
        `Could not resolve field type:
  package: ${pkgId}
  schema:  ${fhirSchema.url}
  field:   ${fieldPath}
  type:    ${element.type}${hint}`
      );
    }
    return mkIdentifier(fieldFs);
  }
  if (element.choices) {
    return void 0;
  }
  if (fhirSchema.derivation === "constraint") {
    return void 0;
  }
  logger?.dryWarn(
    "#fieldTypeNotFound",
    `Can't recognize element type: <${fhirSchema.url}>.${path.join(".")} (pkg: '${packageMetaToFhir(fhirSchema.package_meta)}'): missing type info`
  );
  return void 0;
}
var mkField = (register, fhirSchema, path, element, logger, rawElement) => {
  let binding;
  let enumResult;
  if (element.binding) {
    binding = mkBindingIdentifier(fhirSchema, path, element);
    if (BINDABLE_TYPES.has(element.type ?? "")) {
      enumResult = buildEnum(register, fhirSchema, element, logger);
    }
  }
  const fieldType = buildFieldType(register, fhirSchema, path, element, logger);
  if (!fieldType)
    logger?.dryWarn(
      "#fieldTypeNotFound",
      `Field type not found for '${fhirSchema.url}#${path.join(".")}' (${fhirSchema.derivation})`
    );
  let valueConstraint;
  if (element.pattern) {
    valueConstraint = { kind: "pattern", type: element.pattern.type, value: element.pattern.value };
  } else if (element.fixed) {
    valueConstraint = { kind: "fixed", type: element.fixed.type, value: element.fixed.value };
  }
  const elemForCodingCheck = rawElement ?? element;
  if (!valueConstraint && elemForCodingCheck.elements?.coding?.slicing?.slices) {
    const codingSlices = elemForCodingCheck.elements.coding.slicing.slices;
    const allSliceValues = Object.values(codingSlices);
    const allRequired = allSliceValues.length > 0 && allSliceValues.every(
      (s) => s.min !== void 0 && s.min >= 1 && s.match && typeof s.match === "object" && Object.keys(s.match).length > 0
    );
    if (allRequired) {
      const codingValues = allSliceValues.flatMap((s) => s.match ? [s.match] : []);
      valueConstraint = {
        kind: "fixed",
        type: "CodeableConcept",
        value: {
          coding: codingValues
        }
      };
    }
  }
  return {
    type: fieldType,
    required: isRequired(register, fhirSchema, path),
    excluded: isExcluded(register, fhirSchema, path),
    reference: buildReferences(register, fhirSchema, element),
    array: element.array || false,
    min: element.min,
    max: element.max,
    slicing: buildSlicing(path[path.length - 1] ?? "", element),
    choices: element.choices,
    choiceOf: element.choiceOf,
    binding,
    enum: enumResult,
    valueConstraint,
    mustSupport: element.mustSupport
  };
};
function mkNestedField(register, fhirSchema, path, element) {
  const nestedIdentifier = mkNestedIdentifier(register, fhirSchema, path);
  return {
    type: nestedIdentifier,
    array: element.array || false,
    required: isRequired(register, fhirSchema, path),
    excluded: isExcluded(register, fhirSchema, path),
    slicing: buildSlicing(path[path.length - 1] ?? "", element)
  };
}

// src/typeschema/core/profile-extensions.ts
var extractExtensionValueFieldTypes = (register, fhirSchema, extensionUrl, logger) => {
  const extensionSchema = register.resolveFs(fhirSchema.package_meta, extensionUrl);
  if (!extensionSchema?.elements) return void 0;
  const valueFieldTypes = [];
  for (const [key, element] of Object.entries(extensionSchema.elements)) {
    if (element.choiceOf !== "value" && !key.startsWith("value")) continue;
    const fieldType = buildFieldType(register, extensionSchema, [key], element, logger);
    if (fieldType) valueFieldTypes.push(fieldType);
  }
  return concatIdentifiers(valueFieldTypes);
};
var extractLegacySubExtensions = (register, extensionSchema, logger) => {
  const subExtensions = [];
  if (!extensionSchema.elements) return subExtensions;
  for (const [key, element] of Object.entries(extensionSchema.elements)) {
    if (!key.startsWith("extension:")) continue;
    const sliceName = key.split(":")[1];
    if (!sliceName) continue;
    let valueType;
    for (const [elemKey, elemValue] of Object.entries(element.elements ?? {})) {
      if (elemValue.choiceOf !== "value" && !elemKey.startsWith("value")) continue;
      valueType = buildFieldType(register, extensionSchema, [key, elemKey], elemValue, logger);
      if (valueType) break;
    }
    subExtensions.push({
      name: sliceName,
      url: element.url ?? sliceName,
      valueFieldType: valueType,
      min: element.min,
      max: element.max !== void 0 ? String(element.max) : void 0
    });
  }
  return subExtensions;
};
var extractSlicingSubExtensions = (register, extensionSchema, logger) => {
  const subExtensions = [];
  const extensionElement = extensionSchema.elements?.extension;
  const slices = extensionElement?.slicing?.slices;
  if (!slices || typeof slices !== "object") return subExtensions;
  for (const [sliceName, sliceData] of Object.entries(slices)) {
    const slice = sliceData;
    const schema = slice.schema;
    if (!schema) continue;
    let valueType;
    for (const [elemKey, elemValue] of Object.entries(schema.elements ?? {})) {
      const elem = elemValue;
      if (elem.choiceOf !== "value" && !elemKey.startsWith("value")) continue;
      valueType = buildFieldType(register, extensionSchema, [elemKey], elem, logger);
      if (valueType) break;
    }
    subExtensions.push({
      name: sliceName,
      url: slice.match?.url ?? sliceName,
      valueFieldType: valueType,
      min: schema._required ? 1 : schema.min ?? 0,
      // biome-ignore lint/style/noNestedTernary : okay here
      max: schema.max !== void 0 ? String(schema.max) : schema.array ? "*" : "1"
    });
  }
  return subExtensions;
};
var extractSubExtensions = (register, fhirSchema, extensionUrl, logger) => {
  const extensionSchema = register.resolveFs(fhirSchema.package_meta, extensionUrl);
  if (!extensionSchema?.elements) return void 0;
  const legacySubs = extractLegacySubExtensions(register, extensionSchema, logger);
  const slicingSubs = extractSlicingSubExtensions(register, extensionSchema, logger);
  const subExtensions = [...legacySubs, ...slicingSubs];
  return subExtensions.length > 0 ? subExtensions : void 0;
};
var extractProfileExtensions = (register, fhirSchema, logger) => {
  const extensions = [];
  const addExtensionEntry = (path, name, schema) => {
    let url = schema.url;
    let valueFieldTypes = url ? extractExtensionValueFieldTypes(register, fhirSchema, url, logger) : void 0;
    const subExtensions = url ? extractSubExtensions(register, fhirSchema, url, logger) : void 0;
    if (!url) {
      const sliceSchema = fhirSchema.elements?.extension?.slicing?.slices?.[name]?.schema;
      if (sliceSchema) {
        url = sliceSchema.elements?.url?.fixed?.value ?? name;
        for (const [elemKey, elemValue] of Object.entries(sliceSchema.elements ?? {})) {
          const elem = elemValue;
          if (elem.choiceOf === "value" || elemKey.startsWith("value")) {
            const ft = buildFieldType(register, fhirSchema, [elemKey], elem, logger);
            if (ft) {
              valueFieldTypes = [ft];
              break;
            }
          }
        }
      }
    }
    const isComplex = subExtensions && subExtensions.length > 0;
    const extFs = url ? register.resolveFs(fhirSchema.package_meta, url) : void 0;
    const profile = extFs ? mkIdentifier(extFs) : void 0;
    const extPath = [...path, "extension"].join(".");
    extensions.push({
      name,
      path: extPath,
      url,
      profile,
      min: schema.min,
      max: schema.max !== void 0 ? String(schema.max) : void 0,
      mustSupport: schema.mustSupport,
      valueFieldTypes,
      subExtensions,
      isComplex,
      nameCandidates: mkExtensionNameCandidates({ name, path: extPath })
    });
  };
  const walkElement = (path, element) => {
    if (element.extensions) {
      for (const [name, schema] of Object.entries(element.extensions)) {
        addExtensionEntry(path, name, schema);
      }
    }
    if (element.elements) {
      for (const [key, child] of Object.entries(element.elements)) {
        walkElement([...path, key], child);
      }
    }
  };
  walkElement([], fhirSchema);
  const seen = /* @__PURE__ */ new Set();
  const deduped = extensions.filter((ext) => {
    const key = `${ext.url}:${ext.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.length === 0 ? void 0 : deduped;
};

// src/typeschema/core/transformer.ts
function mkFields(register, fhirSchema, parentPath, elements, logger) {
  if (!elements) return void 0;
  const fields = {};
  for (const key of register.getAllElementKeys(elements)) {
    const path = [...parentPath, key];
    const elemSnapshot = register.resolveElementSnapshot(fhirSchema, path);
    const fcurl = elemSnapshot.type ? register.ensureSpecializationCanonicalUrl(elemSnapshot.type) : void 0;
    if (fcurl && shouldSkipCanonical(fhirSchema.package_meta, fcurl).shouldSkip) {
      logger?.warn(
        "#skipCanonical",
        `Skipping field ${path} for ${fcurl} due to skip hack ${shouldSkipCanonical(fhirSchema.package_meta, fcurl).reason}`
      );
      continue;
    }
    if (isNestedElement(register, fhirSchema, path, elemSnapshot, elements[key])) {
      fields[key] = mkNestedField(register, fhirSchema, path, elemSnapshot);
    } else {
      fields[key] = mkField(register, fhirSchema, path, elemSnapshot, logger, elements[key]);
    }
  }
  return fields;
}
function extractFieldDependencies(fields) {
  const deps = [];
  for (const field of Object.values(fields)) {
    if ("type" in field && field.type) {
      deps.push(field.type);
    }
    if ("binding" in field && field.binding) {
      deps.push(field.binding);
    }
  }
  return deps;
}
async function transformValueSet(register, valueSet, logger) {
  if (!valueSet.url) throw new Error("ValueSet URL is required");
  const identifier = mkValueSetIdentifierByUrl(register, valueSet.package_meta, valueSet.url);
  const concept = extractValueSetConceptsByUrl(register, valueSet.package_meta, valueSet.url);
  return {
    identifier,
    description: valueSet.description,
    concept,
    compose: !concept ? valueSet.compose : void 0
  };
}
var collectRawDeps = (base, fields, nestedTypes) => {
  const deps = [];
  if (base) deps.push(base);
  if (fields) deps.push(...extractFieldDependencies(fields));
  if (nestedTypes) deps.push(...extractNestedDependencies(nestedTypes));
  return deps;
};
var extractDependencies = (identifier, base, fields, nestedTypes) => {
  const deps = collectRawDeps(base, fields, nestedTypes);
  const filtered = deps.filter((dep) => {
    if (dep.url === identifier.url) return false;
    if (isNestedIdentifier(dep)) return false;
    return true;
  });
  return concatIdentifiers(filtered);
};
var extractProfileDependencies = (identifier, base, fields, nestedTypes) => {
  const deps = collectRawDeps(base, fields, nestedTypes);
  const filtered = deps.filter((dep) => dep.url !== identifier.url);
  return concatIdentifiers(filtered);
};
function transformFhirSchema(register, fhirSchema, logger) {
  let base;
  if (fhirSchema.base) {
    const baseFs = register.resolveFs(
      fhirSchema.package_meta,
      register.ensureSpecializationCanonicalUrl(fhirSchema.base)
    );
    if (!baseFs)
      throw new Error(
        `Base resource not found '${fhirSchema.base}' for <${fhirSchema.url}> from ${packageMetaToFhir(fhirSchema.package_meta)}`
      );
    const baseId = mkIdentifier(baseFs);
    assert4(!isNestedIdentifier(baseId), `Unexpected nested base for ${fhirSchema.url}`);
    base = baseId;
  }
  const fields = mkFields(register, fhirSchema, [], fhirSchema.elements, logger);
  const nested = mkNestedTypes(register, fhirSchema, logger);
  const bindingSchemas = collectBindingSchemas(register, fhirSchema, logger);
  if (fhirSchema.derivation === "constraint") {
    const identifier2 = mkIdentifier(fhirSchema);
    if (!base) throw new Error(`Profile ${fhirSchema.url} must have a base type`);
    const extensions = extractProfileExtensions(register, fhirSchema, logger);
    const extensionDeps = extensions?.flatMap(extractExtensionDeps);
    const rawDeps = extractProfileDependencies(identifier2, base, fields, nested);
    const profileSchema = {
      identifier: identifier2,
      base,
      fields,
      nested,
      description: fhirSchema.description,
      dependencies: concatIdentifiers(rawDeps, extensionDeps),
      extensions
    };
    assignRecommendedBaseNames(profileSchema);
    return [profileSchema, ...bindingSchemas];
  }
  if (fhirSchema.kind === "primitive-type") {
    const identifier2 = mkIdentifier(fhirSchema);
    assert4(base, `Primitive type ${fhirSchema.url} must have a base type`);
    return [
      {
        identifier: identifier2,
        description: fhirSchema.description,
        base,
        dependencies: extractDependencies(identifier2, base, fields, nested)
      },
      ...bindingSchemas
    ];
  }
  const identifier = mkIdentifier(fhirSchema);
  const schema = {
    identifier,
    base,
    fields,
    nested,
    description: fhirSchema.description,
    dependencies: extractDependencies(identifier, base, fields, nested),
    typeFamily: void 0
  };
  return [schema, ...bindingSchemas];
}

// src/typeschema/index.ts
var deduplicateSchemas = (schemasWithSources, resolveCollisions, logger) => {
  const groups = {};
  for (const item of schemasWithSources) {
    const key = `${item.schema.identifier.url}|${item.schema.identifier.package}`;
    const hash = hashSchema(item.schema);
    groups[key] ??= {};
    groups[key][hash] ??= { typeSchema: item.schema, sources: [] };
    groups[key][hash].sources.push(item);
  }
  const schemas = [];
  const collisions = {};
  for (const versions of Object.values(groups)) {
    const sorted = Object.entries(versions).map(([schemaHash, version]) => ({
      ...version,
      schemaHash,
      sources: [...version.sources].sort(compareCollisionSources)
    })).sort(compareCollisionVariants);
    const best = sorted[0];
    if (!best) continue;
    if (sorted.length > 1) {
      const url = best.typeSchema.identifier.url;
      const pkg = best.typeSchema.identifier.package;
      const preferredCanonical = resolveCollisions?.[url];
      if (preferredCanonical) {
        const allSources = sorted.flatMap((v) => v.sources);
        const match = sorted.find(
          (v) => v.sources.some(
            (s) => s.sourceCanonical === preferredCanonical.canonical && s.sourcePackage === preferredCanonical.package
          )
        );
        if (match) {
          schemas.push(match.typeSchema);
        } else {
          logger?.dryWarn(
            "#resolveCollisionMiss",
            `'${url}': preferred source '${preferredCanonical.canonical}' from '${preferredCanonical.package}' not found among variants: ${allSources.map((s) => `${s.sourceCanonical} (${s.sourcePackage})`).join(", ")}`
          );
          schemas.push(best.typeSchema);
        }
      } else {
        logger?.dryWarn("#duplicateSchema", `'${url}' from '${pkg}' has ${sorted.length} versions`);
        schemas.push(best.typeSchema);
      }
      collisions[pkg] ??= {};
      collisions[pkg][url] = sorted.flatMap(
        (v) => v.sources.map((s) => ({
          typeSchema: v.typeSchema,
          sourcePackage: s.sourcePackage,
          sourceCanonical: s.sourceCanonical
        }))
      );
    } else {
      schemas.push(best.typeSchema);
    }
  }
  return { schemas, collisions };
};
var generateTypeSchemas = async (register, resolveCollisions, logger) => {
  const schemasWithSources = [];
  for (const fhirSchema of register.allFs()) {
    const pkgId = packageMetaToFhir(fhirSchema.package_meta);
    const skipCheck = shouldSkipCanonical(fhirSchema.package_meta, fhirSchema.url);
    if (skipCheck.shouldSkip) {
      logger?.dryWarn("#skipCanonical", `Skip ${fhirSchema.url} from ${pkgId}. Reason: ${skipCheck.reason}`);
      continue;
    }
    for (const schema of transformFhirSchema(register, fhirSchema, logger)) {
      schemasWithSources.push({
        schema,
        sourcePackage: pkgId,
        sourceCanonical: fhirSchema.url
      });
    }
  }
  for (const vsSchema of register.allVs()) {
    schemasWithSources.push({
      schema: await transformValueSet(register, vsSchema),
      sourcePackage: packageMetaToFhir(vsSchema.package_meta),
      sourceCanonical: vsSchema.url
    });
  }
  return deduplicateSchemas(schemasWithSources, resolveCollisions, logger);
};

// src/typeschema/ir/logic-promotion.ts
var promoteLogical = (tsIndex, promotes) => {
  const promoteSets = Object.fromEntries(
    Object.entries(promotes).map(([pkg, urls]) => [pkg, new Set(urls)])
  );
  const identifierToString = (i) => `${i.package}-${i.version}-${i.kind}-${i.url}`;
  const renames = Object.fromEntries(
    tsIndex.schemas.map((schema) => {
      const promo = promoteSets[schema.identifier.package]?.has(schema.identifier.url);
      if (!promo) return void 0;
      if (!isLogicalTypeSchema(schema))
        throw new Error(`Unexpected schema kind: ${JSON.stringify(schema.identifier)}`);
      return [identifierToString(schema.identifier), { ...schema.identifier, kind: "resource" }];
    }).filter((e) => e !== void 0)
  );
  const replace = (i) => renames[identifierToString(i)] || i;
  const replaceInFields = (fields) => {
    if (!fields) return void 0;
    return Object.fromEntries(
      Object.entries(fields).map(([k, f]) => {
        if (isChoiceDeclarationField(f)) return [k, f];
        return [k, { ...f, type: f.type ? replace(f.type) : void 0 }];
      })
    );
  };
  const schemas = tsIndex.schemas.map((schema) => {
    if (isPrimitiveTypeSchema(schema) || isValueSetTypeSchema(schema)) return schema;
    const cloned = JSON.parse(JSON.stringify(schema));
    cloned.identifier = replace(cloned.identifier);
    cloned.dependencies = cloned.dependencies?.map(replace);
    if (isSpecializationTypeSchema(cloned) || isProfileTypeSchema(cloned)) {
      cloned.fields = replaceInFields(cloned.fields);
      cloned.nested = cloned.nested?.map((n) => {
        return {
          ...n,
          base: replace(n.base),
          fields: replaceInFields(n.fields)
        };
      });
    }
    return cloned;
  });
  const promotedIndex = tsIndex.replaceSchemas(schemas);
  promotedIndex.irReport().logicalPromotion = {
    packages: Object.fromEntries(
      Object.entries(promotes).map(([pkgName, urls]) => [pkgName, { promotedCanonicals: [...urls].sort() }])
    )
  };
  return promotedIndex;
};
var mutableSelectFields = (schema, selectFields) => {
  const selectedFields = {};
  const selectPolimorphic = {};
  for (const fieldName of selectFields) {
    const field = schema.fields?.[fieldName];
    if (!schema.fields || !field) throw new Error(`Field ${fieldName} not found`);
    if (isChoiceDeclarationField(field)) {
      if (!selectPolimorphic[fieldName]) selectPolimorphic[fieldName] = {};
      selectPolimorphic[fieldName].declaration = field.choices;
    } else if (isChoiceInstanceField(field)) {
      const choiceName = field.choiceOf;
      if (!selectPolimorphic[choiceName]) selectPolimorphic[choiceName] = {};
      selectPolimorphic[choiceName].instances = [...selectPolimorphic[choiceName].instances ?? [], fieldName];
    } else {
      selectedFields[fieldName] = field;
    }
  }
  for (const [choiceName, { declaration, instances }] of Object.entries(selectPolimorphic)) {
    const choices = instances ?? declaration;
    assert4(choices);
    for (const choiceInstanceName of choices) {
      const field = schema.fields?.[choiceInstanceName];
      assert4(field);
      selectedFields[choiceInstanceName] = field;
    }
    const decl = schema.fields?.[choiceName];
    assert4(decl);
    selectedFields[choiceName] = { ...decl, choices };
  }
  schema.fields = selectedFields;
};
var mutableIgnoreFields = (schema, ignoreFields) => {
  for (const fieldName of ignoreFields) {
    const field = schema.fields?.[fieldName];
    if (!schema.fields || !field) throw new Error(`Field ${fieldName} not found`);
    if (schema.fields) {
      if (isChoiceDeclarationField(field)) {
        for (const choiceName of field.choices) {
          delete schema.fields[choiceName];
        }
      }
      if (isChoiceInstanceField(field)) {
        const choiceDeclaration = schema.fields[field.choiceOf];
        assert4(isChoiceDeclarationField(choiceDeclaration));
        choiceDeclaration.choices = choiceDeclaration.choices.filter((c) => c !== fieldName);
        if (choiceDeclaration.choices.length === 0) {
          delete schema.fields[field.choiceOf];
        }
      }
      delete schema.fields[fieldName];
    }
  }
};
var mutableIgnoreExtensions = (schema, ignoreExtensions) => {
  if (!schema.extensions) return;
  for (const url of ignoreExtensions) {
    if (!schema.extensions.some((ext) => ext.url === url))
      throw new Error(`Extension ${url} not found in profile ${schema.identifier.url}`);
  }
  schema.extensions = schema.extensions.filter((ext) => !ext.url || !ignoreExtensions.includes(ext.url));
  if (schema.extensions.length === 0) schema.extensions = void 0;
};
var mutableFillReport = (report, tsIndex, shakedIndex) => {
  const packages = Object.keys(tsIndex.schemasByPackage);
  const shakedPackages = Object.keys(shakedIndex.schemasByPackage);
  const skippedPackages = packages.filter((pkg) => !shakedPackages.includes(pkg));
  report.skippedPackages = skippedPackages;
  for (const [pkgName, shakedSchemas] of Object.entries(shakedIndex.schemasByPackage)) {
    if (skippedPackages.includes(pkgName)) continue;
    const tsSchemas = tsIndex.schemasByPackage[pkgName];
    assert4(tsSchemas);
    report.packages[pkgName] = {
      skippedCanonicals: tsSchemas.filter((schema) => !shakedSchemas.includes(schema)).map((schema) => schema.identifier.url).sort(),
      canonicals: Object.fromEntries(
        shakedSchemas.map((shakedSchema) => {
          const schema = tsIndex.resolve(shakedSchema.identifier);
          assert4(schema);
          if (!isSpecializationTypeSchema(schema)) return void 0;
          assert4(isSpecializationTypeSchema(shakedSchema));
          if (!schema.fields) return void 0;
          if (!shakedSchema.fields) {
            return [shakedSchema.identifier.url, Object.keys(schema.fields)];
          }
          const shakedFieldNames = Object.keys(shakedSchema.fields);
          const skippedFields = Object.keys(schema.fields).filter((field) => !shakedFieldNames.includes(field)).sort();
          if (skippedFields.length === 0) return void 0;
          return [shakedSchema.identifier.url, { skippedFields }];
        }).filter((e) => e !== void 0)
      )
    };
  }
};
var treeShakeTypeSchema = (schema, rule, _logger) => {
  schema = JSON.parse(JSON.stringify(schema));
  if (isPrimitiveTypeSchema(schema) || isValueSetTypeSchema(schema) || isBindingSchema(schema) || isSnapshotProfileTypeSchema(schema))
    return schema;
  if (rule.selectFields) {
    if (rule.ignoreFields) throw new Error("Cannot use both ignoreFields and selectFields in the same rule");
    mutableSelectFields(schema, rule.selectFields);
  }
  if (rule.ignoreFields) {
    if (rule.selectFields) throw new Error("Cannot use both ignoreFields and selectFields in the same rule");
    mutableIgnoreFields(schema, rule.ignoreFields);
  }
  if (isProfileTypeSchema(schema) && rule.ignoreExtensions) {
    mutableIgnoreExtensions(schema, rule.ignoreExtensions);
  }
  if (schema.nested) {
    const usedTypes = /* @__PURE__ */ new Set();
    const collectUsedNestedTypes = (s) => {
      Object.values(s.fields ?? {}).filter(isNotChoiceDeclarationField).filter((f) => isNestedIdentifier(f.type)).forEach((f) => {
        const url = f.type.url;
        if (!usedTypes.has(url)) {
          usedTypes.add(url);
          const nestedTypeDef = schema.nested?.find((f2) => f2.identifier.url === url);
          assert4(nestedTypeDef);
          collectUsedNestedTypes(nestedTypeDef);
        }
      });
    };
    collectUsedNestedTypes(schema);
    schema.nested = schema.nested.filter((n) => usedTypes.has(n.identifier.url));
  }
  if (isProfileTypeSchema(schema)) {
    const extDeps = schema.extensions?.flatMap(extractExtensionDeps);
    schema.dependencies = concatIdentifiers(
      extractProfileDependencies(schema.identifier, schema.base, schema.fields, schema.nested),
      extDeps
    );
  } else {
    assert4(!isNestedIdentifier(schema.identifier));
    schema.dependencies = extractDependencies(schema.identifier, schema.base, schema.fields, schema.nested);
  }
  return schema;
};
var collectReferenceTargets = (schema) => {
  if (!isSpecializationTypeSchema(schema) && !isProfileTypeSchema(schema)) return [];
  const fieldSets = [schema.fields, ...(schema.nested ?? []).map((n) => n.fields)];
  return fieldSets.flatMap(
    (fields) => Object.values(fields ?? {}).filter(isNotChoiceDeclarationField).flatMap((f) => [...f.reference?.resource ?? [], ...f.reference?.profiles ?? []]).filter((id) => !isNestedIdentifier(id))
  );
};
var treeShake = (tsIndex, treeShake2, defaults) => {
  const focusedSchemas = [];
  const followedSchemas = [];
  for (const [pkgId, requires] of Object.entries(treeShake2)) {
    for (const [url, rule] of Object.entries(requires)) {
      const schema = tsIndex.resolveByUrl(pkgId, url);
      if (!schema || isNestedTypeSchema(schema)) throw new Error(`Schema not found for ${pkgId} ${url}`);
      const shaked2 = treeShakeTypeSchema(schema, rule);
      focusedSchemas.push(shaked2);
      if (rule.followReferences ?? defaults?.followReferences) {
        for (const refId of collectReferenceTargets(shaked2)) {
          const refSchema = tsIndex.resolve(refId);
          if (!refSchema)
            throw new Error(`Reference target ${JSON.stringify(refId)} not found for ${pkgId} ${url}`);
          followedSchemas.push(refSchema);
        }
      }
    }
  }
  const rootIds = new Set(focusedSchemas.map((s) => JSON.stringify(s.identifier)));
  for (const schema of followedSchemas) {
    if (!rootIds.has(JSON.stringify(schema.identifier))) focusedSchemas.push(schema);
  }
  const collectDeps = (schemas, acc) => {
    if (schemas.length === 0) return Object.values(acc);
    for (const schema of schemas) {
      acc[JSON.stringify(schema.identifier)] = schema;
    }
    const newSchemas = [];
    for (const schema of schemas) {
      if (isSpecializationTypeSchema(schema) || isProfileTypeSchema(schema)) {
        if (!schema.dependencies) continue;
        schema.dependencies.forEach((dep) => {
          if (isNestedIdentifier(dep)) return;
          const depSchema = tsIndex.resolve(dep);
          if (!depSchema)
            throw new Error(
              `Dependent schema ${JSON.stringify(dep)} not found for ${JSON.stringify(schema.identifier)}`
            );
          const id = JSON.stringify(depSchema.identifier);
          if (!acc[id]) newSchemas.push(depSchema);
        });
      }
    }
    return collectDeps(newSchemas, acc);
  };
  const shaked = collectDeps(focusedSchemas, {});
  const shakedIndex = tsIndex.replaceSchemas(shaked);
  const treeShakeReport = { skippedPackages: [], packages: {} };
  const irReport = shakedIndex.irReport();
  irReport.treeShake = treeShakeReport;
  mutableFillReport(treeShakeReport, tsIndex, shakedIndex);
  return shakedIndex;
};
var normalizeFileName = (str) => {
  const res = str.replace(/[^a-zA-Z0-9\-_.@#()]/g, "");
  if (res.length === 0) return "unknown";
  return res;
};
var typeSchemaToJson = (ts, pretty) => {
  const pkgPath = normalizeFileName(ts.identifier.package);
  const suffix = isSnapshotProfileTypeSchema(ts) ? ".snapshot" : "";
  const name = normalizeFileName(`${ts.identifier.name}(${extractNameFromCanonical(ts.identifier.url)})`) + suffix;
  const baseName = Path5.join(pkgPath, name);
  return {
    filename: baseName,
    genContent: () => JSON.stringify(ts, null, pretty ? 2 : void 0)
  };
};
var fhirSchemaToJson = (fs6, pretty) => {
  const pkgPath = normalizeFileName(fs6.package_meta.name);
  const name = normalizeFileName(`${fs6.name}(${extractNameFromCanonical(fs6.url)})`);
  const baseName = Path5.join(pkgPath, name);
  return {
    filename: baseName,
    genContent: () => JSON.stringify(fs6, null, pretty ? 2 : void 0)
  };
};
var structureDefinitionToJson = (sd, pretty) => {
  const pkgPath = normalizeFileName(sd.package_name ?? "unknown");
  const name = normalizeFileName(`${sd.name}(${extractNameFromCanonical(sd.url)})`);
  const baseName = Path5.join(pkgPath, name);
  return {
    filename: baseName,
    // HACK: for some reason ID may change between CI and local install
    genContent: () => JSON.stringify({ ...sd, id: void 0 }, null, pretty ? 2 : void 0)
  };
};
var IntrospectionWriter = class extends FileSystemWriter {
  async generate(tsIndex) {
    this.logger()?.info(`IntrospectionWriter: Begin`);
    if (this.opts.typeTree) {
      await this.writeTypeTree(tsIndex);
      this.logger()?.info(`IntrospectionWriter: Type tree written to ${this.opts.typeTree}`);
    }
    if (this.opts.typeSchemas) {
      const tsOpts = typeof this.opts.typeSchemas === "string" ? { target: this.opts.typeSchemas } : this.opts.typeSchemas;
      const schemas = tsOpts.profileSnapshots ? [...tsIndex.schemas, ...tsIndex.collectSnapshotProfiles()] : tsIndex.schemas;
      if (Path5.extname(tsOpts.target) === ".ndjson") {
        await this.writeNdjson(schemas, tsOpts.target, typeSchemaToJson);
      } else {
        const items = schemas.map((ts) => typeSchemaToJson(ts, true));
        const seenFilenames = /* @__PURE__ */ new Set();
        const dedupedItems = items.filter((item) => {
          if (seenFilenames.has(item.filename)) return false;
          seenFilenames.add(item.filename);
          return true;
        });
        this.cd(tsOpts.target, () => {
          for (const { filename, genContent } of dedupedItems) {
            const fileName = `${filename}.json`;
            this.cd(Path5.dirname(fileName), () => {
              this.cat(Path5.basename(fileName), () => {
                this.write(genContent());
              });
            });
          }
          for (const [pkg, canonicals] of Object.entries(tsIndex.irReport().collisions ?? {})) {
            this.cd(`${normalizeFileName(pkg)}`, () => {
              for (const [canonical, entries] of Object.entries(canonicals)) {
                if (entries.length <= 1) continue;
                const firstEntry = entries[0];
                assert4(firstEntry);
                const name = normalizeFileName(
                  `${firstEntry.typeSchema.identifier.name}(${extractNameFromCanonical(canonical)})`
                );
                this.cd(Path5.join("collisions", name), () => {
                  for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    this.cat(`${i + 1}.json`, () => {
                      this.write(JSON.stringify(entry, null, 2));
                    });
                  }
                });
              }
            });
          }
        });
      }
      this.logger()?.info(`IntrospectionWriter: ${schemas.length} TypeSchema written to ${tsOpts.target}`);
    }
    const indexUrls = new Set(tsIndex.schemas.map((ts) => ts.identifier.url));
    if (this.opts.fhirSchemas && tsIndex.register) {
      const outputPath = this.opts.fhirSchemas;
      const allFs = tsIndex.register.allFs();
      const seenUrls = /* @__PURE__ */ new Set();
      const fhirSchemas = allFs.filter((fs6) => {
        if (!indexUrls.has(fs6.url)) return false;
        if (seenUrls.has(fs6.url)) return false;
        seenUrls.add(fs6.url);
        return true;
      });
      if (Path5.extname(outputPath) === ".ndjson") {
        await this.writeNdjson(fhirSchemas, outputPath, fhirSchemaToJson);
      } else {
        await this.writeJsonFiles(
          fhirSchemas.map((fs6) => fhirSchemaToJson(fs6, true)),
          outputPath
        );
      }
      this.logger()?.info(`IntrospectionWriter: ${fhirSchemas.length} FHIR schema written to ${outputPath}`);
    }
    if (this.opts.structureDefinitions && tsIndex.register) {
      const outputPath = this.opts.structureDefinitions;
      const allSd = tsIndex.register.allSd();
      const seenUrls = /* @__PURE__ */ new Set();
      const structureDefinitions = allSd.filter((sd) => {
        if (!indexUrls.has(sd.url)) return false;
        if (seenUrls.has(sd.url)) return false;
        seenUrls.add(sd.url);
        return true;
      });
      if (Path5.extname(outputPath) === ".ndjson") {
        await this.writeNdjson(structureDefinitions, outputPath, structureDefinitionToJson);
      } else {
        await this.writeJsonFiles(
          structureDefinitions.map((sd) => structureDefinitionToJson(sd, true)),
          outputPath
        );
      }
      this.logger()?.info(
        `IntrospectionWriter: ${structureDefinitions.length} StructureDefinitions written to ${outputPath}`
      );
    }
  }
  async writeNdjson(items, outputFile, toJson) {
    this.cd(Path5.dirname(outputFile), () => {
      this.cat(Path5.basename(outputFile), () => {
        for (const item of items) {
          const { genContent } = toJson(item, false);
          this.write(`${genContent()}
`);
        }
      });
    });
  }
  async writeJsonFiles(items, outputDir) {
    this.cd(outputDir, () => {
      for (const { filename, genContent } of items) {
        const fileName = `${filename}.json`;
        this.cd(Path5.dirname(fileName), () => {
          this.cat(Path5.basename(fileName), () => {
            this.write(genContent());
          });
        });
      }
    });
  }
  async writeTypeTree(tsIndex) {
    const filename = this.opts.typeTree;
    if (!filename) return;
    const tree = tsIndex.entityTree();
    const raw = filename.endsWith(".yaml") ? YAML__default.stringify(tree) : JSON.stringify(tree, void 0, 2);
    const dir = Path5.dirname(filename);
    const file = Path5.basename(filename);
    this.cd(dir, () => {
      this.cat(file, () => {
        this.write(raw);
      });
    });
  }
};

// src/typeschema/ir/report.ts
var generateSkippedPackagesSection = (lines, skippedPackages) => {
  lines.push("## Skipped Packages", "");
  for (const pkg of [...skippedPackages].sort()) {
    lines.push(`- ${pkg}`);
  }
  lines.push("");
};
var generatePackageSection = (lines, pkgName, treeShakePkg, promotedCanonicals) => {
  lines.push(`## Package: \`${pkgName}\``, "");
  if (promotedCanonicals?.length) {
    lines.push("### Promoted Logical Models", "");
    for (const canonical of promotedCanonicals) {
      lines.push(`- \`${canonical}\``);
    }
    lines.push("");
  }
  if (!treeShakePkg) return;
  const canonicalsWithChanges = Object.entries(treeShakePkg.canonicals).filter(
    ([_, data]) => data.skippedFields.length > 0
  );
  if (canonicalsWithChanges.length > 0) {
    lines.push("### Modified Canonicals", "");
    for (const [canonical, data] of canonicalsWithChanges) {
      lines.push(`#### \`${canonical}\``, "");
      lines.push("Skipped fields:", "");
      for (const field of data.skippedFields) {
        lines.push(`- \`${field}\``);
      }
      lines.push("");
    }
  }
  if (treeShakePkg.skippedCanonicals.length > 0) {
    lines.push("### Skipped Canonicals", "");
    for (const canonical of treeShakePkg.skippedCanonicals) {
      lines.push(`- \`${canonical}\``);
    }
    lines.push("");
  }
};
var groupCollisionVersions = (entries, resolution) => {
  const uniqueSchemas = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = hashSchema(entry.typeSchema);
    if (!uniqueSchemas.has(key)) uniqueSchemas.set(key, []);
    uniqueSchemas.get(key)?.push(entry);
  }
  const sorted = [...uniqueSchemas.entries()].map(([schemaHash, group]) => ({
    entries: [...group].sort(compareCollisionSources),
    schemaHash,
    sources: group
  })).sort(compareCollisionVariants).map((group) => group.entries);
  const markVersion = (group, i) => {
    if (resolution)
      return group.some(
        (e) => e.sourceCanonical === resolution.canonical && e.sourcePackage === resolution.package
      ) ? "selected" : void 0;
    return i === 0 ? "auto" : void 0;
  };
  return sorted.map((group, i) => ({ entries: group, mark: markVersion(group, i) }));
};
var versionMarkLabel = { selected: " (selected)", auto: " (auto)" };
var generateCollisionVersionLines = (versions) => {
  let version = 1;
  return versions.map((v) => {
    const sourceList = v.entries.map((e) => {
      const name = extractNameFromCanonical(e.sourceCanonical) ?? e.sourceCanonical;
      return `${name} (${e.sourcePackage})`;
    }).sort().join(", ");
    const mark = v.mark ? versionMarkLabel[v.mark] : "";
    return `  - Version ${version++}${mark}: ${sourceList}`;
  });
};
var generateCollisionsSection = (lines, collisions, resolveCollisions) => {
  if (!collisions) return;
  lines.push("## Schema Collisions", "");
  lines.push("The following canonicals have multiple schema versions with different content.");
  lines.push("To inspect collision versions, export TypeSchemas using `.introspection({ typeSchemas: 'path' })`");
  lines.push("and check `<pkg>/collisions/<name>/1.json, 2.json, ...` files.", "");
  const allCollisions = [];
  const collisionPackages = Object.keys(collisions).sort();
  for (const pkgName of collisionPackages) {
    const collisionsPkg = collisions[pkgName];
    if (!collisionsPkg) throw new Error(`Missing collisions for package ${pkgName}`);
    const sortedEntries = Object.entries(collisionsPkg).sort(([a], [b]) => {
      const nameA = a.split("/").pop() ?? a;
      const nameB = b.split("/").pop() ?? b;
      return nameA.localeCompare(nameB);
    });
    if (sortedEntries.length > 0) {
      lines.push(`### \`${pkgName}\``, "");
      for (const [canonical, entries] of sortedEntries) {
        const versions = groupCollisionVersions(entries, resolveCollisions?.[canonical]);
        const versionLines = generateCollisionVersionLines(versions);
        lines.push(`- \`${canonical}\` (${versions.length} versions)`);
        lines.push(...versionLines);
        if (entries[0]) allCollisions.push({ url: canonical, firstSource: entries[0] });
      }
      lines.push("");
    }
  }
  if (allCollisions.length > 0) {
    const unresolved = allCollisions.filter((c) => !resolveCollisions?.[c.url]);
    if (unresolved.length > 0) {
      lines.push("### Suggested `resolveCollisions` config", "");
      lines.push("Add to `.typeSchema({ resolveCollisions: { ... } })` to resolve remaining collisions:", "");
      lines.push("```typescript");
      lines.push(".typeSchema({");
      lines.push("    resolveCollisions: {");
      for (const { url, firstSource } of unresolved) {
        lines.push(`        "${url}": {`);
        lines.push(`            package: "${firstSource.sourcePackage}",`);
        lines.push(`            canonical: "${firstSource.sourceCanonical}",`);
        lines.push("        },");
      }
      lines.push("    },");
      lines.push("})");
      lines.push("```", "");
    }
  }
};
var generateIrReportReadme = (report) => {
  const lines = ["# IR Report", ""];
  const irPackages = [
    .../* @__PURE__ */ new Set([
      ...Object.keys(report.treeShake?.packages ?? {}),
      ...Object.keys(report.logicalPromotion?.packages ?? {})
    ])
  ].sort();
  const hasIrChanges = irPackages.length > 0 || (report.treeShake?.skippedPackages.length ?? 0) > 0;
  const hasCollisions = Object.keys(report.collisions ?? {}).length > 0;
  if (!hasIrChanges && !hasCollisions) {
    lines.push("No IR modifications applied.");
    return lines.join("\n");
  }
  if (report.treeShake?.skippedPackages.length) {
    generateSkippedPackagesSection(lines, report.treeShake.skippedPackages);
  }
  for (const pkgName of irPackages) {
    generatePackageSection(
      lines,
      pkgName,
      report.treeShake?.packages[pkgName],
      report.logicalPromotion?.packages[pkgName]?.promotedCanonicals
    );
  }
  if (hasCollisions) {
    generateCollisionsSection(lines, report.collisions, report.resolveCollisions);
  }
  return lines.join("\n");
};

// src/api/writer-generator/ir-report.ts
var IrReportWriterWriter = class extends FileSystemWriter {
  async generate(tsIndex) {
    const report = tsIndex.irReport();
    const md = generateIrReportReadme(report);
    this.cd("/", () => {
      this.cat(this.opts.rootReadmeFileName, () => {
        this.write(md);
      });
    });
  }
};

// src/api/mustache/generator/DebugMixinProvider.ts
var DebugMixinProvider = class {
  constructor(mode) {
    this.mode = mode;
  }
  mode;
  apply(target) {
    return this._addDebug(target);
  }
  _addDebug(value) {
    if (Array.isArray(value)) {
      return value.map((v) => this._addDebug(v));
    }
    if (value !== null && typeof value === "object") {
      const obj = value;
      const result = {};
      const debugString = JSON.stringify(obj, null, this.mode === "FORMATTED" ? 2 : void 0);
      for (const [key, val] of Object.entries(obj)) {
        result[key] = this._addDebug(val);
      }
      result.debug = debugString;
      return result;
    }
    return value;
  }
};

// src/api/mustache/generator/LambdaMixinProvider.ts
var LambdaMixinProvider = class {
  constructor(nameGenerator) {
    this.nameGenerator = nameGenerator;
    this.lambda = {
      saveTypeName: () => (text, render) => this.nameGenerator.generateType(render(text)),
      saveEnumValueName: () => (text, render) => this.nameGenerator.generateEnumValue(render(text)),
      saveFieldName: () => (text, render) => this.nameGenerator.generateField(render(text)),
      camelCase: () => (text, render) => camelCase(render(text)),
      snakeCase: () => (text, render) => snakeCase(render(text)),
      pascalCase: () => (text, render) => pascalCase(render(text)),
      kebabCase: () => (text, render) => kebabCase(render(text)),
      lowerCase: () => (text, render) => render(text).toLowerCase(),
      upperCase: () => (text, render) => render(text).toUpperCase()
    };
  }
  nameGenerator;
  lambda;
  apply(target) {
    return {
      ...target,
      lambda: this.lambda
    };
  }
};

// src/api/mustache/generator/NameGenerator.ts
var NameGenerator = class {
  constructor(keywords, typeMap, nameTransformations, unsaveCharacterPattern) {
    this.keywords = keywords;
    this.typeMap = typeMap;
    this.nameTransformations = nameTransformations;
    this.unsaveCharacterPattern = unsaveCharacterPattern;
  }
  keywords;
  typeMap;
  nameTransformations;
  unsaveCharacterPattern;
  _replaceUnsaveChars(name) {
    const pattern = this.unsaveCharacterPattern instanceof RegExp ? this.unsaveCharacterPattern : new RegExp(this.unsaveCharacterPattern, "g");
    return name.replace(pattern, "_");
  }
  _applyNameTransformations(name, transformations) {
    for (const transformation of this.nameTransformations.common) {
      name = name.replace(
        transformation.pattern instanceof RegExp ? transformation.pattern : new RegExp(transformation.pattern, "g"),
        transformation.format
      );
    }
    for (const transformation of transformations) {
      name = name.replace(
        transformation.pattern instanceof RegExp ? transformation.pattern : new RegExp(transformation.pattern, "g"),
        transformation.format
      );
    }
    return name;
  }
  _generateTypeName(name) {
    if (this.typeMap[name]) {
      name = this.typeMap[name];
    } else {
      name = this._applyNameTransformations(name, this.nameTransformations.type);
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (this.keywords.has(name)) {
        return `_${name}`;
      }
      name = this._replaceUnsaveChars(name);
    }
    return name;
  }
  generateEnumType(name) {
    return this._generateTypeName(name);
  }
  _generateTypeFromTypeRef(typeRef) {
    if (typeRef.kind === "primitive-type") {
      return this._generateTypeName(typeRef.name);
    }
    return this._generateTypeName(
      typeRef.url.split("/").pop()?.split("#").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("") ?? "<UNKNOWN>"
    );
  }
  generateFieldType(schema) {
    if (schema.enum) {
      return this.generateEnumType(schema.binding?.name ?? schema.type.name);
    }
    return this._generateTypeFromTypeRef(schema.type);
  }
  generateType(schemaOrRefOrString) {
    if (typeof schemaOrRefOrString === "string") {
      return this._generateTypeName(schemaOrRefOrString);
    }
    if ("url" in schemaOrRefOrString) {
      return this._generateTypeFromTypeRef(schemaOrRefOrString);
    }
    return this._generateTypeFromTypeRef(schemaOrRefOrString.identifier);
  }
  generateField(name) {
    name = this._applyNameTransformations(name, this.nameTransformations.field);
    if (this.keywords.has(name)) {
      return `_${name}`;
    }
    name = this._replaceUnsaveChars(name);
    return name;
  }
  generateEnumValue(name) {
    name = this._applyNameTransformations(name, this.nameTransformations.enumValue);
    if (this.keywords.has(name)) {
      return `_${name}`;
    }
    name = this._replaceUnsaveChars(name).toUpperCase();
    return name;
  }
};
var TemplateFileCache = class {
  templateBaseDir;
  templateCache = {};
  constructor(templateBaseDir) {
    this.templateBaseDir = Path5__default.resolve(templateBaseDir);
  }
  _normalizeName(name) {
    if (name.endsWith(".mustache")) {
      return name;
    }
    return `${name}.mustache`;
  }
  read(template) {
    return this.readTemplate(template.source);
  }
  readTemplate(name) {
    const normalizedName = this._normalizeName(name);
    if (!this.templateCache[normalizedName]) {
      this.templateCache[normalizedName] = fs__default.readFileSync(
        Path5__default.join(this.templateBaseDir, normalizedName),
        "utf-8"
      );
    }
    return this.templateCache[normalizedName];
  }
};

// src/api/mustache/generator/ListElementInformationMixinProvider.ts
var ListElementInformationMixinProvider = class _ListElementInformationMixinProvider {
  static _array(value) {
    return Array.isArray(value) ? value : Array.from(value);
  }
  apply(source) {
    return this._addListElementInformation(source);
  }
  _addListElementInformation(value) {
    if (Array.isArray(value) || value instanceof Set) {
      return _ListElementInformationMixinProvider._array(value).map((v, index, array) => {
        if (typeof v === "object" && v !== null) {
          return {
            ...this._addListElementInformation(v),
            "-index": index,
            "-length": array.length,
            "-first": index === 0,
            "-last": index === array.length - 1
          };
        }
        return v;
      });
    }
    if (value !== null && typeof value === "object") {
      const obj = value;
      const result = {};
      for (const [key, val] of Object.entries(obj)) {
        result[key] = this._addListElementInformation(val);
      }
      return result;
    }
    return value;
  }
};

// src/api/mustache/types.ts
var PRIMITIVE_TYPES = [
  "boolean",
  "instant",
  "time",
  "date",
  "dateTime",
  "decimal",
  "integer",
  "unsignedInt",
  "positiveInt",
  "integer64",
  "base64Binary",
  "uri",
  "url",
  "canonical",
  "oid",
  "uuid",
  "string",
  "code",
  "markdown",
  "id",
  "xhtml"
];

// src/api/mustache/generator/ViewModelFactory.ts
var ViewModelFactory = class {
  constructor(tsIndex, nameGenerator, filterPred) {
    this.tsIndex = tsIndex;
    this.nameGenerator = nameGenerator;
    this.filterPred = filterPred;
  }
  tsIndex;
  nameGenerator;
  filterPred;
  arrayMixinProvider = new ListElementInformationMixinProvider();
  createUtility() {
    return this._createForRoot();
  }
  createComplexType(typeRef, cache = { resourcesByUri: {}, complexTypesByUri: {} }) {
    const base = this._createForComplexType(typeRef, cache);
    const parents = this._createParentsFor(base.schema, cache);
    const children = this._createChildrenFor(typeRef, cache);
    const inheritedFields = parents.flatMap((p) => p.fields);
    return this.arrayMixinProvider.apply({
      ...this._createForRoot(),
      ...base,
      parents,
      children,
      inheritedFields,
      allFields: [...base.fields, ...parents.flatMap((p) => p.fields)],
      hasChildren: children.length > 0,
      hasParents: parents.length > 0,
      hasInheritedFields: inheritedFields.length > 0
    });
  }
  createResource(typeRef, cache = { resourcesByUri: {}, complexTypesByUri: {} }) {
    const base = this._createForResource(typeRef, cache);
    const parents = this._createParentsFor(base.schema, cache);
    const children = this._createChildrenFor(typeRef, cache);
    const inheritedFields = parents.flatMap((p) => p.fields);
    return this.arrayMixinProvider.apply({
      ...this._createForRoot(),
      ...base,
      parents,
      children,
      inheritedFields,
      allFields: [...base.fields, ...inheritedFields],
      hasChildren: children.length > 0,
      hasParents: parents.length > 0,
      hasInheritedFields: inheritedFields.length > 0
    });
  }
  _createFor(typeRef, cache, nestedIn) {
    if (typeRef.kind === "complex-type") {
      return this._createForComplexType(typeRef, cache, nestedIn);
    }
    if (typeRef.kind === "resource") {
      return this._createForResource(typeRef, cache, nestedIn);
    }
    throw new Error(`Unknown type ${typeRef.kind}`);
  }
  _createForComplexType(typeRef, cache, nestedIn) {
    const type = this.tsIndex.resolveType(typeRef);
    if (!type) {
      throw new Error(`ComplexType ${typeRef.name} not found`);
    }
    if (!Object.hasOwn(cache.complexTypesByUri, type.identifier.url)) {
      cache.complexTypesByUri[type.identifier.url] = this._createTypeViewModel(type, cache, nestedIn);
    }
    const res = cache.complexTypesByUri[type.identifier.url];
    if (!res) throw new Error(`ComplexType ${typeRef.name} not found`);
    return res;
  }
  _createForResource(typeRef, cache, nestedIn) {
    const type = this.tsIndex.resolveType(typeRef);
    if (!type) {
      throw new Error(`Resource ${typeRef.name} not found`);
    }
    if (!Object.hasOwn(cache.resourcesByUri, type.identifier.url)) {
      cache.resourcesByUri[type.identifier.url] = this._createTypeViewModel(type, cache, nestedIn);
    }
    const res = cache.resourcesByUri[type.identifier.url];
    if (!res) throw new Error(`Resource ${typeRef.name} not found`);
    return res;
  }
  _createChildrenFor(typeRef, cache, nestedIn) {
    const schema = this.tsIndex.resolveType(typeRef);
    if (!schema) return [];
    if (isComplexTypeTypeSchema(schema)) {
      return (schema.typeFamily?.complexTypes ?? []).filter(this.filterPred).map((childRef) => this._createFor(childRef, cache, nestedIn));
    }
    if (isResourceTypeSchema(schema)) {
      return (schema.typeFamily?.resources ?? []).filter(this.filterPred).map((childRef) => this._createFor(childRef, cache, nestedIn));
    }
    return [];
  }
  _createParentsFor(base, cache) {
    const parents = [];
    let parentRef = "base" in base ? base.base : void 0;
    while (parentRef) {
      parents.push(this._createFor(parentRef, cache, void 0));
      const parent = this.tsIndex.resolveType(parentRef);
      parentRef = parent && "base" in parent ? parent.base : void 0;
    }
    return parents;
  }
  _createForNestedType(nested, cache, nestedIn) {
    const base = this._createTypeViewModel(nested, cache, nestedIn);
    const parents = this._createParentsFor(nested, cache);
    const children = this._createChildrenFor(nested.identifier, cache, nestedIn);
    const inheritedFields = parents.flatMap((p) => p.fields);
    return {
      ...base,
      parents,
      children,
      inheritedFields,
      allFields: [...base.fields, ...inheritedFields],
      hasChildren: children.length > 0,
      hasParents: parents.length > 0,
      hasInheritedFields: inheritedFields.length > 0
    };
  }
  _createTypeViewModel(schema, cache, nestedIn) {
    const fields = Object.entries(("fields" in schema ? schema.fields : {}) ?? {});
    const nestedComplexTypes = this._collectNestedComplex(schema, cache);
    const nestedEnums = this._collectNestedEnums(fields);
    const dependencies = this._collectDependencies(schema);
    const name = {
      name: schema.identifier.name,
      saveName: this.nameGenerator.generateType(schema)
    };
    return {
      nestedComplexTypes,
      nestedEnums,
      dependencies,
      isNested: !!nestedIn,
      schema,
      ...name,
      isResource: this._createIsResource(schema.identifier),
      isComplexType: this._createIsComplexType(schema.identifier),
      hasFields: fields.length > 0,
      hasNestedComplexTypes: nestedComplexTypes.length > 0,
      hasNestedEnums: nestedEnums.length > 0,
      fields: fields.filter(
        (entry) => isNotChoiceDeclarationField(entry[1])
      ).sort((a, b) => a[0].localeCompare(b[0])).map(([fieldName, field]) => {
        return {
          owner: name,
          schema: field,
          name: fieldName,
          saveName: this.nameGenerator.generateField(fieldName),
          typeName: this.nameGenerator.generateFieldType(field),
          isArray: field.array ?? false,
          isRequired: field.required ?? false,
          isEnum: !!field.enum && !field.enum.isOpen,
          isSizeConstrained: field.min !== void 0 || field.max !== void 0,
          min: field.min,
          max: field.max,
          isResource: this._createIsResource(field.type),
          isComplexType: this._createIsComplexType(field.type),
          isPrimitive: this._createIsPrimitiveType(field.type),
          isCode: field.type?.name === "code",
          isIdentifier: field.type?.name === "Identifier",
          isReference: field.type?.name === "Reference"
        };
      })
    };
  }
  _collectDependencies(schema) {
    const dependencies = {
      resources: [],
      complexTypes: []
    };
    if ("dependencies" in schema && schema.dependencies) {
      schema.dependencies.filter((dependency) => dependency.kind === "complex-type").map((dependency) => ({ name: dependency.name, saveName: this.nameGenerator.generateType(dependency) })).forEach((dependency) => {
        dependencies.complexTypes.push(dependency);
      });
      schema.dependencies.filter((dependency) => dependency.kind === "resource").map((dependency) => ({ name: dependency.name, saveName: this.nameGenerator.generateType(dependency) })).forEach((dependency) => {
        dependencies.resources.push(dependency);
      });
    }
    if ("nested" in schema && schema.nested) {
      schema.nested.map((nested) => this._collectDependencies(nested)).forEach((d) => {
        d.complexTypes.filter(
          (complexType) => !dependencies.complexTypes.some((dependency) => dependency.name === complexType.name)
        ).forEach((complexType) => {
          dependencies.complexTypes.push(complexType);
        });
        d.resources.filter(
          (resource) => !dependencies.resources.some((dependency) => dependency.name === resource.name)
        ).forEach((resource) => {
          dependencies.resources.push(resource);
        });
      });
    }
    return dependencies;
  }
  _createIsResource(typeRef) {
    if (typeRef.kind !== "resource") {
      return false;
    }
    return Object.fromEntries(
      this.tsIndex.collectResources().map((e) => e.identifier).map((resourceRef) => [
        `is${resourceRef.name.charAt(0).toUpperCase() + resourceRef.name.slice(1)}`,
        resourceRef.url === typeRef.url
      ])
    );
  }
  _createIsComplexType(typeRef) {
    if (typeRef.kind !== "complex-type" && typeRef.kind !== "nested") {
      return false;
    }
    return Object.fromEntries(
      this.tsIndex.collectComplexTypes().map((e) => e.identifier).map((complexTypeRef) => [
        `is${complexTypeRef.name.charAt(0).toUpperCase() + complexTypeRef.name.slice(1)}`,
        complexTypeRef.url === typeRef.url
      ])
    );
  }
  _createIsPrimitiveType(typeRef) {
    if (typeRef.kind !== "primitive-type") {
      return false;
    }
    return Object.fromEntries(
      PRIMITIVE_TYPES.map((type) => [`is${type.charAt(0).toUpperCase()}${type.slice(1)}`, typeRef.name === type])
    );
  }
  _collectNestedComplex(schema, cache) {
    const nested = [];
    if ("nested" in schema && schema.nested) {
      schema.nested.map((nested2) => this._createForNestedType(nested2, cache, schema)).forEach((n) => {
        nested.push(n);
      });
    }
    return nested;
  }
  _collectNestedEnums(fields) {
    const nestedEnumValues = {};
    fields.forEach(([fieldName, fieldSchema]) => {
      if ("enum" in fieldSchema && fieldSchema.enum && !fieldSchema.enum.isOpen) {
        const name = ("binding" in fieldSchema && fieldSchema.binding?.name) ?? fieldName;
        if (typeof name === "string") {
          nestedEnumValues[name] = nestedEnumValues[name] ?? /* @__PURE__ */ new Set();
          fieldSchema.enum.values.forEach(nestedEnumValues[name].add.bind(nestedEnumValues[name]));
        }
      }
    });
    return Object.entries(nestedEnumValues).map(([name, values]) => ({
      name,
      saveName: this.nameGenerator.generateEnumType(name),
      values: Array.from(values).map((value) => ({
        name: value,
        saveName: this.nameGenerator.generateEnumValue(value)
      }))
    }));
  }
  _createForRoot() {
    return this.arrayMixinProvider.apply({
      complexTypes: this.tsIndex.collectComplexTypes().map((e) => e.identifier).map((typeRef) => ({
        name: typeRef.name,
        saveName: this.nameGenerator.generateType(typeRef)
      })),
      resources: this.tsIndex.collectResources().map((e) => e.identifier).map((typeRef) => ({
        name: typeRef.name,
        saveName: this.nameGenerator.generateType(typeRef)
      }))
    });
  }
};
function loadMustacheGeneratorConfig(templatePath, logger) {
  const filePath = Path5.resolve(templatePath, "config.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
  }
  return {};
}
var createGenerator = (templatePath, apiOpts) => {
  const defaultFileOpts = {
    debug: "OFF",
    hooks: {},
    meta: {},
    keywords: [],
    unsaveCharacterPattern: /[^a-zA-Z0-9]/g,
    nameTransformations: {
      common: [],
      enumValue: [],
      type: [],
      field: []
    },
    renderings: {
      utility: [],
      resource: [],
      complexType: []
    },
    shouldRunHooks: true,
    primitiveTypeMap: {}
  };
  const actualFileOpts = loadMustacheGeneratorConfig(templatePath);
  const mustacheOptions = {
    ...defaultFileOpts,
    ...apiOpts,
    ...actualFileOpts,
    sources: {
      staticSource: Path5.resolve(templatePath, "static"),
      templateSource: Path5.resolve(templatePath, "templates")
    }
  };
  return new MustacheGenerator(mustacheOptions);
};
function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve6, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      ...options
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve6(code);
      else reject(new Error(`Prozess beendet mit Fehlercode ${code}`));
    });
  });
}
var MustacheGenerator = class extends FileSystemWriter {
  templateFileCache;
  nameGenerator;
  lambdaMixinProvider;
  debugMixinProvider;
  constructor(opts) {
    super(opts);
    this.nameGenerator = new NameGenerator(
      new Set(opts.keywords),
      opts.primitiveTypeMap,
      opts.nameTransformations,
      opts.unsaveCharacterPattern
    );
    this.templateFileCache = new TemplateFileCache(opts.sources.templateSource);
    this.lambdaMixinProvider = new LambdaMixinProvider(this.nameGenerator);
    this.debugMixinProvider = opts.debug !== "OFF" ? new DebugMixinProvider(opts.debug) : void 0;
  }
  async generate(tsIndex) {
    const modelFactory = new ViewModelFactory(tsIndex, this.nameGenerator, () => true);
    const cache = {
      resourcesByUri: {},
      complexTypesByUri: {}
    };
    tsIndex.collectComplexTypes().map((i) => i.identifier).sort((a, b) => a.url.localeCompare(b.url)).map((typeRef) => modelFactory.createComplexType(typeRef, cache)).forEach(this._renderComplexType.bind(this));
    tsIndex.collectResources().map((i) => i.identifier).sort((a, b) => a.url.localeCompare(b.url)).map((typeRef) => modelFactory.createResource(typeRef, cache)).forEach(this._renderResource.bind(this));
    this._renderUtility(modelFactory.createUtility());
    this.copyStaticFiles();
    if (this.opts.shouldRunHooks) {
      await this._runHooks(this.opts.hooks.afterGenerate);
    }
    return;
  }
  copyStaticFiles() {
    const staticDir = Path5.resolve(this.opts.sources.staticSource);
    if (!staticDir) {
      throw new Error("staticDir must be set in subclass.");
    }
    fs.cpSync(staticDir, this.opts.outputDir, { recursive: true });
  }
  async _runHooks(hooks) {
    for (const hook of hooks ?? []) {
      console.info(`Running hook (${this.opts.outputDir}): ${hook.cmd} ${hook.args?.join(" ")}`);
      await runCommand(hook.cmd, hook.args ?? [], {
        cwd: this.opts.outputDir
      });
      console.info(`Completed hook: ${hook.cmd} ${hook.args?.join(" ")}`);
    }
  }
  _checkRenderingFilter(model, rendering) {
    if (!rendering.filter?.whitelist?.length && !rendering.filter?.blacklist?.length) {
      return true;
    }
    if ((rendering.filter?.blacklist ?? []).find((v) => model.name.match(v))) {
      return false;
    }
    if ((rendering.filter?.whitelist ?? []).find((v) => model.name.match(v))) {
      return true;
    }
    return !rendering.filter.whitelist?.length;
  }
  _renderUtility(model) {
    this.opts.renderings.utility.forEach((rendering) => {
      this.cd(rendering.path, () => {
        this.cat(rendering.fileNameFormat, () => {
          this.write(this._render(model, rendering));
        });
      });
    });
  }
  _renderResource(model) {
    this.opts.renderings.resource.filter((rendering) => this._checkRenderingFilter(model, rendering)).forEach((rendering) => {
      this.cd(rendering.path, () => {
        this.cat(this._calculateFilename(model, rendering), () => {
          this.write(this._render(model, rendering));
        });
      });
    });
  }
  _renderComplexType(model) {
    this.opts.renderings.complexType.filter((rendering) => this._checkRenderingFilter(model, rendering)).forEach((rendering) => {
      this.cd(rendering.path, () => {
        this.cat(this._calculateFilename(model, rendering), () => {
          this.write(this._render(model, rendering));
        });
      });
    });
  }
  _calculateFilename(model, rendering) {
    return util.format(rendering.fileNameFormat, model.saveName);
  }
  _render(model, rendering) {
    let view = this.lambdaMixinProvider.apply({
      meta: {
        timestamp: this.opts.meta.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
        generator: this.opts.meta.generator ?? "@atomic-ehr/codegen mustache generator"
      },
      model,
      properties: rendering.properties ?? {}
    });
    if (this.debugMixinProvider) {
      view = this.debugMixinProvider.apply(view);
    }
    return Mustache.render(
      this.templateFileCache.read(rendering),
      view,
      (partialName) => this.templateFileCache.readTemplate(partialName)
    );
  }
};

// src/api/writer-generator/typescript/name.ts
var tsKeywords = /* @__PURE__ */ new Set(["class", "function", "return", "if", "for", "while", "const", "let", "var", "import", "export", "interface"]);
var normalizeTsName = (n) => {
  if (tsKeywords.has(n)) n = `${n}_`;
  return n.replace(/\[x\]/g, "_x_").replace(/[- :.]/g, "_");
};
var tsCamelCase = (name) => {
  if (!name) return "";
  const normalized = name.replace(/\[x\]/g, "").replace(/:/g, "_");
  return camelCase(normalized);
};
var tsPackageDir = (name) => {
  return kebabCase(name.replace(/[@/]/g, "_"));
};
var tsModuleName = (id) => {
  return uppercaseFirstLetter(tsResourceName(id));
};
var tsModuleFileName = (id) => {
  return `${tsModuleName(id)}.ts`;
};
var tsModulePath = (id) => {
  return `${tsPackageDir(id.package)}/${tsModuleName(id)}`;
};
var tsNameFromCanonical = (canonical, dropFragment = true) => {
  if (!canonical) return void 0;
  const localName = extractNameFromCanonical(canonical, dropFragment);
  if (!localName) return void 0;
  return normalizeTsName(localName);
};
var tsResourceName = (id) => {
  if (id.kind === "nested") {
    const url = id.url;
    const localName = extractNameFromCanonical(url, false);
    if (!localName) return "";
    const [resourceName, fragment] = localName.split("#");
    const name2 = uppercaseFirstLetterOfEach((fragment ?? "").split(".")).join("");
    return normalizeTsName([resourceName, name2].join(""));
  }
  const name = id.name.includes("/") ? extractNameFromCanonical(id.name) ?? id.name : id.name;
  return normalizeTsName(name);
};
var tsFieldName = (n) => {
  if (tsKeywords.has(n)) return `"${n}"`;
  if (n.includes(" ") || n.includes("-")) return `"${n}"`;
  return n;
};
var tsProfileModuleName = (tsIndex, schema) => {
  const resourceId = tsIndex.findLastSpecializationByIdentifier(schema.identifier);
  const resourceName = uppercaseFirstLetter(normalizeTsName(resourceId.name));
  return `${resourceName}_${normalizeTsName(schema.identifier.name)}`;
};
var tsProfileModuleFileName = (tsIndex, schema) => {
  return `${tsProfileModuleName(tsIndex, schema)}.ts`;
};
var tsProfileClassName = (schema) => {
  const name = normalizeTsName(schema.identifier.name);
  return name.endsWith("Profile") ? name : `${name}Profile`;
};
var tsSliceFlatTypeName = (profileName, fieldName, sliceName) => {
  return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(fieldName))}_${uppercaseFirstLetter(normalizeTsName(sliceName))}SliceFlat`;
};
var tsSliceFlatAllTypeName = (profileName, fieldName, sliceName) => {
  return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(fieldName))}_${uppercaseFirstLetter(normalizeTsName(sliceName))}SliceFlatAll`;
};
var tsExtensionFlatTypeName = (profileName, extensionName) => {
  return `${uppercaseFirstLetter(profileName)}_${uppercaseFirstLetter(normalizeTsName(extensionName))}Flat`;
};
var tsSliceStaticName = (name) => name.replace(/\[x\]/g, "").replace(/[^a-zA-Z0-9_$]/g, "_");
var tsValueFieldName = (id) => `value${uppercaseFirstLetter(id.name)}`;

// src/api/writer-generator/typescript/utils.ts
var primitiveType2tsType = {
  boolean: "boolean",
  instant: "string",
  time: "string",
  date: "string",
  dateTime: "string",
  decimal: "number",
  integer: "number",
  unsignedInt: "number",
  positiveInt: "number",
  integer64: "number",
  base64Binary: "string",
  uri: "string",
  url: "string",
  canonical: "string",
  oid: "string",
  uuid: "string",
  string: "string",
  code: "string",
  markdown: "string",
  id: "string",
  xhtml: "string"
};
var resolvePrimitiveType = (name) => {
  const tsType = primitiveType2tsType[name];
  if (tsType === void 0) throw new Error(`Unknown primitive type ${name}`);
  return tsType;
};
var tsGet = (object, tsFieldName2) => {
  if (tsFieldName2.startsWith('"')) return `${object}[${tsFieldName2}]`;
  return `${object}.${tsFieldName2}`;
};
var tsEnumType = (enumDef) => {
  const values = enumDef.values.map((e) => `"${e}"`).join(" | ");
  return enumDef.isOpen ? `(${values} | string)` : `(${values})`;
};
var rewriteFieldTypeDefs = {
  Coding: { code: () => "T" },
  Reference: {
    reference: () => (
      // biome-ignore lint/suspicious/noTemplateCurlyInString: emitted as a TS template literal type, the placeholders are intentional
      "`${T}/${string}` | `http://${string}` | `https://${string}` | `urn:uuid:${string}` | `urn:oid:${string}` | `#${string}`"
    )
  },
  CodeableConcept: { coding: () => "Coding<T>" }
};
var resolveFieldTsType = (schemaName, tsName, field, resolveRef, genericFieldMap, isFamilyType) => {
  if (genericFieldMap?.[tsName]) return genericFieldMap[tsName];
  const rewriteFieldType = rewriteFieldTypeDefs[schemaName]?.[tsName];
  if (rewriteFieldType) return rewriteFieldType();
  if (field.enum) {
    if (field.type.name === "Coding") return `Coding<${tsEnumType(field.enum)}>`;
    if (field.type.name === "CodeableConcept") return `CodeableConcept<${tsEnumType(field.enum)}>`;
    return tsEnumType(field.enum);
  }
  if (field.reference && field.reference.resource.length > 0) {
    const resolved = field.reference.resource.map((ref) => resolveRef ? resolveRef(ref) : ref);
    const references = resolved.map((ref) => isFamilyType?.(ref) ? `string /* ${ref.name} */` : `"${ref.name}"`).join(" | ");
    return `Reference<${references}>`;
  }
  if (isPrimitiveIdentifier(field.type)) return resolvePrimitiveType(field.type.name);
  if (isNestedIdentifier(field.type)) return tsResourceName(field.type);
  return field.type.name;
};
var fieldTsType = (field, resolveRef, isFamilyType) => resolveFieldTsType("", "", field, resolveRef, void 0, isFamilyType) + (field.array ? "[]" : "");
var tsTypeFromIdentifier = (id) => {
  if (isNestedIdentifier(id)) return tsResourceName(id);
  if (isPrimitiveIdentifier(id)) return resolvePrimitiveType(id.name);
  const primitiveType = primitiveType2tsType[id.name];
  if (primitiveType !== void 0) return primitiveType;
  return id.name;
};

// src/api/writer-generator/typescript/profile-extensions.ts
var extractValueField = (elements) => {
  if (!elements) return void 0;
  return elements.find((e) => e.startsWith("value") && e !== "value");
};
var VALUE_PREFIX_RE = /^value/;
var valueFieldToTsType = (valueField) => {
  const fhirName = valueField.replace(VALUE_PREFIX_RE, "");
  const primitives = {
    String: "string",
    Boolean: "boolean",
    Integer: "number",
    Decimal: "number",
    Date: "string",
    DateTime: "string",
    Time: "string",
    Instant: "string",
    Uri: "string",
    Url: "string",
    Canonical: "string",
    Code: "string",
    Oid: "string",
    Id: "string",
    Markdown: "string",
    UnsignedInt: "number",
    PositiveInt: "number",
    Uuid: "string",
    Base64Binary: "string"
  };
  return primitives[fhirName] ?? fhirName;
};
var collectSubExtensionSlices = (extProfile) => {
  const extensionField = extProfile.fields.extension;
  if (!extensionField || isChoiceDeclarationField(extensionField) || !extensionField.slicing?.slices) return [];
  const result = [];
  for (const [sliceName, slice] of Object.entries(extensionField.slicing.slices)) {
    const valueField = extractValueField(slice.elements);
    if (!valueField) continue;
    const tsType = valueFieldToTsType(valueField);
    const isArray = slice.max === void 0;
    const isRequired2 = slice.min !== void 0 && slice.min >= 1;
    result.push({
      name: tsCamelCase(sliceName) || sliceName,
      url: sliceName,
      valueField,
      tsType,
      isArray,
      isRequired: isRequired2
    });
  }
  return result;
};
var resolveExtensionProfile2 = (tsIndex, pkgName, url) => {
  const schema = tsIndex.resolveByUrl(pkgName, url);
  if (!schema || !isProfileTypeSchema(schema)) return void 0;
  if (schema.identifier.package !== pkgName) return void 0;
  const snapshot = tsIndex.resolve(snapshotIdentifier(schema.identifier));
  if (!snapshot) return void 0;
  const className = tsProfileClassName(snapshot);
  const modulePath = `./${tsProfileModuleName(tsIndex, snapshot)}`;
  return { className, modulePath, snapshot };
};
var generateRawExtensionBody = (w, ext, targetPath, paramName = "input", useUpsert = false) => {
  w.line(
    `if (${paramName}.url !== ${JSON.stringify(ext.url)}) throw new Error(\`Expected extension url '${ext.url}', got '\${${paramName}.url}'\`)`
  );
  generateExtensionPush(w, targetPath, paramName, useUpsert);
};
var generateExtensionPush = (w, targetPath, extExpr, useUpsert = false) => {
  const fn = useUpsert ? "upsertExtension" : "pushExtension";
  if (targetPath.length === 0) {
    w.line(`${fn}(this.resource, ${extExpr})`);
  } else {
    w.line(
      `const target = ensurePath(this.resource as unknown as Record<string, unknown>, ${JSON.stringify(targetPath)})`
    );
    w.line("if (!Array.isArray(target.extension)) target.extension = [] as Extension[]");
    w.line(`${fn}(target as unknown as { extension?: Extension[] }, ${extExpr})`);
  }
};
var generateExtLookup = (w, ext, targetPath) => {
  if (targetPath.length === 0) {
    w.line(`const ext = this.resource.extension?.find(e => e.url === "${ext.url}")`);
  } else {
    w.line(
      `const target = ensurePath(this.resource as unknown as Record<string, unknown>, ${JSON.stringify(targetPath)})`
    );
    w.line(`const ext = (target.extension as Extension[] | undefined)?.find(e => e.url === "${ext.url}")`);
  }
};
var effectiveGetterDefault = (w, hasProfile) => {
  const configured = w.opts.extensionGetterDefault ?? "flat";
  if (configured === "profile" && !hasProfile) return "flat";
  return configured;
};
var returnTypeForMode = (mode, inputType, profileClassName) => {
  if (mode === "profile" && profileClassName) return profileClassName;
  if (mode === "raw") return "Extension";
  return inputType;
};
var generateExtensionGetterOverloads = (w, ext, targetPath, methodName, inputType, extProfileInfo, generateInputBody) => {
  const hasProfile = !!extProfileInfo;
  const defaultMode = effectiveGetterDefault(w, hasProfile);
  const modes = hasProfile ? ["flat", "profile", "raw"] : ["flat", "raw"];
  for (const mode of modes) {
    const rt = returnTypeForMode(mode, inputType, extProfileInfo?.className);
    w.lineSM(`public ${methodName}(mode: '${mode}'): ${rt} | undefined`);
  }
  const defaultReturn = returnTypeForMode(defaultMode, inputType, extProfileInfo?.className);
  w.lineSM(`public ${methodName}(): ${defaultReturn} | undefined`);
  const allReturns = [...new Set(modes.map((m) => returnTypeForMode(m, inputType, extProfileInfo?.className)))];
  const modesUnion = modes.map((m) => `'${m}'`).join(" | ");
  w.curlyBlock(
    ["public", methodName, `(mode: ${modesUnion} = '${defaultMode}'): ${allReturns.join(" | ")} | undefined`],
    () => {
      generateExtLookup(w, ext, targetPath);
      w.line("if (!ext) return undefined");
      w.line("if (mode === 'raw') return ext");
      if (hasProfile) {
        w.line(`if (mode === 'profile') return ${extProfileInfo?.className}.apply(ext)`);
      }
      generateInputBody();
    }
  );
};
var generateComplexExtensionSetter2 = (w, info) => {
  const { ext, snapshot, setMethodName, targetPath, extProfileInfo } = info;
  const tsProfileName = tsResourceName(snapshot.identifier);
  const inputTypeName = tsExtensionFlatTypeName(tsProfileName, ext.name);
  const extProfileHasFlatInput = extProfileInfo ? collectSubExtensionSlices(extProfileInfo.snapshot).length > 0 : false;
  const useUpsert = ext.max === "1";
  if (extProfileInfo && extProfileHasFlatInput) {
    const paramType = `${extProfileInfo.className}Flat | ${extProfileInfo.className} | Extension`;
    w.curlyBlock(["public", setMethodName, `(input: ${paramType}): this`], () => {
      w.ifElseChain(
        [
          {
            cond: `input instanceof ${extProfileInfo.className}`,
            body: () => generateExtensionPush(w, targetPath, "input.toResource()", useUpsert)
          },
          {
            cond: "isExtension<Extension>(input)",
            body: () => generateRawExtensionBody(w, ext, targetPath, "input", useUpsert)
          }
        ],
        () => generateExtensionPush(
          w,
          targetPath,
          `${extProfileInfo.className}.createResource(input)`,
          useUpsert
        )
      );
      w.line("return this");
    });
  } else {
    w.curlyBlock(["public", setMethodName, `(input: ${inputTypeName}): this`], () => {
      w.line("const subExtensions: Extension[] = []");
      for (const sub of ext.subExtensions ?? []) {
        const valueField = sub.valueFieldType ? tsValueFieldName(sub.valueFieldType) : "value";
        if (sub.max === "*") {
          w.curlyBlock(["if", `(input.${sub.name})`], () => {
            w.curlyBlock(["for", `(const item of input.${sub.name})`], () => {
              w.line(`subExtensions.push({ url: "${sub.url}", ${valueField}: item } as Extension)`);
            });
          });
        } else {
          w.curlyBlock(["if", `(input.${sub.name} !== undefined)`], () => {
            w.line(
              `subExtensions.push({ url: "${sub.url}", ${valueField}: input.${sub.name} } as Extension)`
            );
          });
        }
      }
      const extLiteral = `{ url: "${ext.url}", extension: subExtensions }`;
      const fn = useUpsert ? "upsertExtension" : "pushExtension";
      if (targetPath.length === 0) {
        w.line(`${fn}(this.resource, ${extLiteral})`);
      } else {
        w.line(
          `const target = ensurePath(this.resource as unknown as Record<string, unknown>, ${JSON.stringify(targetPath)})`
        );
        w.line("if (!Array.isArray(target.extension)) target.extension = [] as Extension[]");
        w.line(`${fn}(target as unknown as { extension?: Extension[] }, ${extLiteral})`);
      }
      w.line("return this");
    });
  }
};
var generateComplexExtensionGetter2 = (w, info) => {
  const { ext, snapshot, getMethodName, targetPath, extProfileInfo } = info;
  const tsProfileName = tsResourceName(snapshot.identifier);
  const inputTypeName = tsExtensionFlatTypeName(tsProfileName, ext.name);
  const extProfileHasFlatInput = extProfileInfo ? collectSubExtensionSlices(extProfileInfo.snapshot).length > 0 : false;
  const inputType = extProfileHasFlatInput && extProfileInfo ? `${extProfileInfo.className}Flat` : inputTypeName;
  generateExtensionGetterOverloads(w, ext, targetPath, getMethodName, inputType, extProfileInfo, () => {
    const configItems = (ext.subExtensions ?? []).map((sub) => {
      const valueField = sub.valueFieldType ? tsValueFieldName(sub.valueFieldType) : "value";
      const isArray = sub.max === "*";
      return `{ name: "${sub.url}", valueField: "${valueField}", isArray: ${isArray} }`;
    });
    w.line(`const config = [${configItems.join(", ")}]`);
    w.line(`return extractComplexExtension<${inputType}>(ext, config)`);
  });
};
var generateSingleValueExtensionSetter2 = (w, tsIndex, info) => {
  const { ext, setMethodName, targetPath, extProfileInfo } = info;
  const firstValueType = ext.valueFieldTypes?.[0];
  if (!firstValueType) return;
  const valueType = tsTypeFromIdentifier(firstValueType);
  const valueField = tsValueFieldName(firstValueType);
  const useUpsert = ext.max === "1";
  if (extProfileInfo) {
    const extFactoryInfo = collectProfileFactoryInfo2(tsIndex, extProfileInfo.snapshot);
    const extValueParam = extFactoryInfo.params.find((p) => p.name === valueField);
    const resolvedValueType = extValueParam?.tsType ?? valueType;
    const paramType = `${extProfileInfo.className} | Extension | ${resolvedValueType}`;
    const elseExpr = extValueParam ? `${extProfileInfo.className}.createResource({ ${valueField}: value as ${resolvedValueType} })` : `{ url: "${ext.url}", ${valueField}: value as ${valueType} } as Extension`;
    w.curlyBlock(["public", setMethodName, `(value: ${paramType}): this`], () => {
      w.ifElseChain(
        [
          {
            cond: `value instanceof ${extProfileInfo.className}`,
            body: () => generateExtensionPush(w, targetPath, "value.toResource()", useUpsert)
          },
          {
            cond: "isExtension(value)",
            body: () => generateRawExtensionBody(w, ext, targetPath, "value", useUpsert)
          }
        ],
        () => generateExtensionPush(w, targetPath, elseExpr, useUpsert)
      );
      w.line("return this");
    });
  } else {
    w.curlyBlock(["public", setMethodName, `(value: ${valueType}): this`], () => {
      const extLiteral = `{ url: "${ext.url}", ${valueField}: value } as Extension`;
      generateExtensionPush(w, targetPath, extLiteral, useUpsert);
      w.line("return this");
    });
  }
};
var generateSingleValueExtensionGetter2 = (w, info) => {
  const { ext, getMethodName, targetPath, extProfileInfo } = info;
  const firstValueType = ext.valueFieldTypes?.[0];
  if (!firstValueType) return;
  const valueType = tsTypeFromIdentifier(firstValueType);
  const valueField = tsValueFieldName(firstValueType);
  generateExtensionGetterOverloads(w, ext, targetPath, getMethodName, valueType, extProfileInfo, () => {
    w.line(`return getExtensionValue<${valueType}>(ext, "${valueField}")`);
  });
};
var generateGenericExtensionSetter2 = (w, info) => {
  const { ext, setMethodName, targetPath } = info;
  const useUpsert = ext.max === "1";
  w.curlyBlock(["public", setMethodName, `(value: Omit<Extension, "url"> | Extension): this`], () => {
    w.ifElseChain(
      [
        {
          cond: "isExtension(value)",
          body: () => generateRawExtensionBody(w, ext, targetPath, "value", useUpsert)
        }
      ],
      () => generateExtensionPush(w, targetPath, `{ url: "${ext.url}", ...value } as Extension`, useUpsert)
    );
    w.line("return this");
  });
};
var generateGenericExtensionGetter2 = (w, info) => {
  const { ext, getMethodName, targetPath } = info;
  w.curlyBlock(["public", getMethodName, "(): Extension | undefined"], () => {
    if (targetPath.length === 0) {
      w.line(`return this.resource.extension?.find(e => e.url === "${ext.url}")`);
    } else {
      w.line(
        `const target = ensurePath(this.resource as unknown as Record<string, unknown>, ${JSON.stringify(targetPath)})`
      );
      w.line(`return (target.extension as Extension[] | undefined)?.find(e => e.url === "${ext.url}")`);
    }
  });
};
var generateExtensionMethods2 = (w, tsIndex, snapshot) => {
  for (const ext of snapshot.extensions ?? []) {
    if (!ext.url) continue;
    const baseName = ext.nameCandidates.recommended;
    const targetPath = ext.path.split(".").filter((segment) => segment !== "extension");
    const extProfileInfo = resolveExtensionProfile2(tsIndex, snapshot.identifier.package, ext.url);
    const info = {
      ext,
      snapshot,
      setMethodName: `set${baseName}`,
      getMethodName: `get${baseName}`,
      targetPath,
      extProfileInfo
    };
    if (ext.isComplex && ext.subExtensions) {
      generateComplexExtensionSetter2(w, info);
      w.line();
      generateComplexExtensionGetter2(w, info);
    } else if (ext.valueFieldTypes?.length === 1 && ext.valueFieldTypes[0]) {
      generateSingleValueExtensionSetter2(w, tsIndex, info);
      w.line();
      generateSingleValueExtensionGetter2(w, info);
    } else {
      generateGenericExtensionSetter2(w, info);
      w.line();
      generateGenericExtensionGetter2(w, info);
    }
    w.line();
  }
};
var collectTypesFromExtensions = (tsIndex, snapshot, addType) => {
  let needsExtensionType = false;
  for (const ext of snapshot.extensions ?? []) {
    if (ext.isComplex && ext.subExtensions) {
      needsExtensionType = true;
      for (const sub of ext.subExtensions) {
        if (!sub.valueFieldType) continue;
        const resolvedType = tsIndex.resolveByUrl(
          snapshot.identifier.package,
          sub.valueFieldType.url
        );
        addType(resolvedType?.identifier ?? sub.valueFieldType);
      }
    } else if (ext.valueFieldTypes && ext.valueFieldTypes.length === 1) {
      needsExtensionType = true;
      if (ext.valueFieldTypes[0]) {
        const resolvedType = tsIndex.resolveByUrl(
          snapshot.identifier.package,
          ext.valueFieldTypes[0].url
        );
        addType(resolvedType?.identifier ?? ext.valueFieldTypes[0]);
      }
    } else {
      needsExtensionType = true;
    }
  }
  return needsExtensionType;
};
var collectTypesFromFlatInput = (tsIndex, snapshot, addType) => {
  if (snapshot.base.name !== "Extension") return;
  const subSlices = collectSubExtensionSlices(snapshot);
  for (const sub of subSlices) {
    const tsType = sub.tsType;
    if (["string", "boolean", "number"].includes(tsType)) continue;
    const fhirUrl = `http://hl7.org/fhir/StructureDefinition/${tsType}`;
    const schema = tsIndex.resolveByUrl(snapshot.identifier.package, fhirUrl);
    if (schema) addType(schema.identifier);
  }
};

// src/api/writer-generator/typescript/profile-slices.ts
var collectChoiceBaseNames = (tsIndex, typeId) => {
  const names = /* @__PURE__ */ new Set();
  const schema = tsIndex.resolveType(typeId);
  if (schema && "fields" in schema && schema.fields) {
    for (const [name, f] of Object.entries(schema.fields)) {
      if (isChoiceDeclarationField(f)) names.add(name);
    }
  }
  return names;
};
var extractResourceTypeFromMatch = (match) => {
  for (const value of Object.values(match)) {
    if (typeof value !== "object" || value === null) continue;
    const obj = value;
    if (typeof obj.resourceType === "string") return obj.resourceType;
    const nested = extractResourceTypeFromMatch(obj);
    if (nested) return nested;
  }
  return void 0;
};
var collectTypesFromSlices = (tsIndex, snapshot, addType) => {
  const pkgName = snapshot.identifier.package;
  for (const field of Object.values(snapshot.fields)) {
    if (!isNotChoiceDeclarationField(field) || !field.slicing?.slices || !field.type) continue;
    const isTypeDisc = field.slicing.discriminator?.some((d) => d.type === "type") ?? false;
    for (const slice of Object.values(field.slicing.slices)) {
      if (Object.keys(slice.match ?? {}).length > 0) {
        addType(field.type);
        const cc = slice.elements ? tsIndex.constrainedChoice(pkgName, field.type, slice.elements) : void 0;
        if (cc) addType(cc.variantType);
        if (isTypeDisc && slice.match) {
          const resourceTypeName = extractResourceTypeFromMatch(slice.match);
          if (resourceTypeName) {
            const resourceSchema = tsIndex.schemas.find(
              (s) => s.identifier.name === resourceTypeName && s.identifier.kind === "resource"
            );
            if (resourceSchema) addType(resourceSchema.identifier);
          }
        }
      }
    }
  }
};
var collectRequiredSliceNames2 = (field) => {
  if (!field.array || !field.slicing?.slices) return void 0;
  const isTypeDisc = field.slicing.discriminator?.some((d) => d.type === "type") ?? false;
  if (isTypeDisc) return void 0;
  const names = Object.entries(field.slicing.slices).filter(([_, s]) => {
    if (s.min === void 0 || s.min < 1 || !s.match || Object.keys(s.match).length === 0) return false;
    const matchKeys = new Set(Object.keys(s.match));
    const requiredBeyondMatch = (s.required ?? []).filter((name) => !matchKeys.has(name));
    return requiredBeyondMatch.length === 0;
  }).map(([name]) => name);
  return names.length > 0 ? names : void 0;
};
var collectSliceDefs2 = (tsIndex, snapshot) => Object.entries(snapshot.fields).filter(([_, field]) => isNotChoiceDeclarationField(field) && field.slicing?.slices).flatMap(([fieldName, field]) => {
  if (!isNotChoiceDeclarationField(field) || !field.slicing?.slices || !field.type) return [];
  const baseType = tsTypeFromIdentifier(field.type);
  const pkgName = snapshot.identifier.package;
  const choiceBaseNames = collectChoiceBaseNames(tsIndex, field.type);
  const isTypeDisc = field.slicing.discriminator?.some((d) => d.type === "type") ?? false;
  return Object.entries(field.slicing.slices).filter(([_, slice]) => Object.keys(slice.match ?? {}).length > 0).map(([sliceName, slice]) => {
    const matchFields = Object.keys(slice.match ?? {});
    const required = (slice.required ?? []).filter(
      (name) => !matchFields.includes(name) && !choiceBaseNames.has(name)
    );
    const cc = slice.elements ? tsIndex.constrainedChoice(pkgName, field.type, slice.elements) : void 0;
    const constrainedChoice = cc && !isPrimitiveIdentifier(cc.variantType) ? cc : void 0;
    const resourceType = isTypeDisc ? extractResourceTypeFromMatch(slice.match ?? {}) : void 0;
    const typedBaseType = resourceType ? `${baseType}<${resourceType}>` : baseType;
    return {
      fieldName,
      baseType,
      typedBaseType,
      sliceName,
      baseName: slice.nameCandidates.recommended,
      match: slice.match ?? {},
      required,
      excluded: slice.excluded ?? [],
      array: Boolean(field.array),
      constrainedChoice,
      typeDiscriminator: isTypeDisc,
      max: slice.max ?? 0
    };
  });
});
var generateSliceSetters2 = (w, sliceDefs, snapshot) => {
  const profileClassName = tsProfileClassName(snapshot);
  const tsProfileName = tsResourceName(snapshot.identifier);
  for (const sliceDef of sliceDefs) {
    const baseName = sliceDef.baseName;
    const methodName = `set${baseName}`;
    const inputTypeName = tsSliceFlatTypeName(tsProfileName, sliceDef.fieldName, sliceDef.sliceName);
    const matchRef = `${profileClassName}.${tsSliceStaticName(sliceDef.sliceName)}SliceMatch`;
    const tsField = tsFieldName(sliceDef.fieldName);
    const fieldAccess = tsGet("this.resource", tsField);
    const baseType = sliceDef.typedBaseType;
    const isUnbounded = sliceDef.array && (sliceDef.max === 0 || sliceDef.max === void 0);
    if (isUnbounded) {
      const unionType = `(${inputTypeName} | ${baseType})[]`;
      const paramSignature = `(input: ${unionType}): this`;
      w.curlyBlock(["public", methodName, paramSignature], () => {
        w.line(`const match = ${matchRef}`);
        w.line(`const arr = ${fieldAccess} ??= []`);
        if (sliceDef.constrainedChoice) {
          const cc = sliceDef.constrainedChoice;
          w.line(
            `const values = input.map(item => matchesValue(item, match) ? item as ${baseType} : applySliceMatch<${baseType}>(wrapSliceChoice<${baseType}>(item, ${JSON.stringify(cc.variant)}), match))`
          );
        } else {
          w.line(
            `const values = input.map(item => matchesValue(item, match) ? item as ${baseType} : applySliceMatch<${baseType}>(item, match))`
          );
        }
        w.line("setArraySliceAll(arr, match, values)");
        w.line("return this");
      });
    } else {
      const inputOptional = sliceDef.required.length === 0;
      const unionType = `${inputTypeName} | ${baseType}`;
      const paramSignature = inputOptional ? `(input?: ${unionType}): this` : `(input: ${unionType}): this`;
      w.curlyBlock(["public", methodName, paramSignature], () => {
        w.line(`const match = ${matchRef}`);
        w.curlyBlock(["if", "(input && matchesValue(input, match))"], () => {
          if (sliceDef.array) {
            w.line(`setArraySlice(${fieldAccess} ??= [], match, input as ${baseType})`);
          } else {
            w.line(`${fieldAccess} = input as ${baseType}`);
          }
          w.line("return this");
        });
        const inputExpr = inputOptional ? "input ?? {}" : "input";
        if (sliceDef.constrainedChoice) {
          const cc = sliceDef.constrainedChoice;
          w.line(`const wrapped = wrapSliceChoice<${baseType}>(${inputExpr}, ${JSON.stringify(cc.variant)})`);
          w.line(`const value = applySliceMatch<${baseType}>(wrapped, match)`);
        } else {
          w.line(`const value = applySliceMatch<${baseType}>(${inputExpr}, match)`);
        }
        if (sliceDef.array) {
          w.line(`setArraySlice(${fieldAccess} ??= [], match, value)`);
        } else {
          w.line(`${fieldAccess} = value`);
        }
        w.line("return this");
      });
    }
    w.line();
  }
};
var generateSliceGetters2 = (w, sliceDefs, snapshot) => {
  const profileClassName = tsProfileClassName(snapshot);
  const tsProfileName = tsResourceName(snapshot.identifier);
  const defaultMode = w.opts.sliceGetterDefault ?? "flat";
  for (const sliceDef of sliceDefs) {
    const baseName = sliceDef.baseName;
    const getMethodName = `get${baseName}`;
    const flatTypeName = tsSliceFlatAllTypeName(tsProfileName, sliceDef.fieldName, sliceDef.sliceName);
    const matchRef = `${profileClassName}.${tsSliceStaticName(sliceDef.sliceName)}SliceMatch`;
    const matchKeys = JSON.stringify(Object.keys(sliceDef.match));
    const tsField = tsFieldName(sliceDef.fieldName);
    const fieldAccess = tsGet("this.resource", tsField);
    const baseType = sliceDef.typedBaseType;
    const isUnbounded = sliceDef.array && (sliceDef.max === 0 || sliceDef.max === void 0);
    if (isUnbounded) {
      const defaultReturn = defaultMode === "raw" ? `${baseType}[]` : `${flatTypeName}[]`;
      w.lineSM(`public ${getMethodName}(mode: 'flat'): ${flatTypeName}[] | undefined`);
      w.lineSM(`public ${getMethodName}(mode: 'raw'): ${baseType}[] | undefined`);
      w.lineSM(`public ${getMethodName}(): ${defaultReturn} | undefined`);
      w.curlyBlock(
        [
          "public",
          getMethodName,
          `(mode: 'flat' | 'raw' = '${defaultMode}'): (${flatTypeName} | ${baseType})[] | undefined`
        ],
        () => {
          w.line(`const match = ${matchRef}`);
          w.line(`const items = getArraySliceAll(${fieldAccess}, match)`);
          w.line("if (items.length === 0) return undefined");
          if (sliceDef.typeDiscriminator) {
            w.line(`if (mode === 'raw') return items as ${baseType}[]`);
          } else {
            w.line("if (mode === 'raw') return items");
          }
          if (sliceDef.constrainedChoice) {
            const cc = sliceDef.constrainedChoice;
            w.line(
              `return items.map(item => unwrapSliceChoice<${flatTypeName}>(item, ${matchKeys}, ${JSON.stringify(cc.variant)}))`
            );
          } else {
            w.line(`return items as unknown as ${flatTypeName}[]`);
          }
        }
      );
    } else {
      const defaultReturn = defaultMode === "raw" ? baseType : flatTypeName;
      w.lineSM(`public ${getMethodName}(mode: 'flat'): ${flatTypeName} | undefined`);
      w.lineSM(`public ${getMethodName}(mode: 'raw'): ${baseType} | undefined`);
      w.lineSM(`public ${getMethodName}(): ${defaultReturn} | undefined`);
      w.curlyBlock(
        [
          "public",
          getMethodName,
          `(mode: 'flat' | 'raw' = '${defaultMode}'): ${flatTypeName} | ${baseType} | undefined`
        ],
        () => {
          w.line(`const match = ${matchRef}`);
          if (sliceDef.array) {
            w.line(`const item = getArraySlice(${fieldAccess}, match)`);
            w.line("if (!item) return undefined");
          } else {
            w.line(`const item = ${fieldAccess}`);
            w.line("if (!item || !matchesValue(item, match)) return undefined");
          }
          if (sliceDef.typeDiscriminator) {
            w.line(`if (mode === 'raw') return item as ${baseType}`);
          } else {
            w.line("if (mode === 'raw') return item");
          }
          if (sliceDef.constrainedChoice) {
            const cc = sliceDef.constrainedChoice;
            w.line(
              `return unwrapSliceChoice<${flatTypeName}>(item, ${matchKeys}, ${JSON.stringify(cc.variant)})`
            );
          } else {
            w.line(`return item as unknown as ${flatTypeName}`);
          }
        }
      );
    }
    w.line();
  }
};

// src/api/writer-generator/typescript/profile-validation.ts
var collectRegularFieldValidation = (errors, warnings, name, field, resolveRef, canonicalUrlExpr, tsIndex) => {
  if (field.excluded) {
    errors.push(`...validateExcluded(res, profileName, ${JSON.stringify(name)})`);
    return;
  }
  if (field.required) errors.push(`...validateRequired(res, profileName, ${JSON.stringify(name)})`);
  if (field.valueConstraint) {
    const valueExpr = canonicalUrlExpr && name === "url" && field.valueConstraint.value === canonicalUrlExpr.url ? canonicalUrlExpr.expr : JSON.stringify(field.valueConstraint.value);
    errors.push(`...validateFixedValue(res, profileName, ${JSON.stringify(name)}, ${valueExpr})`);
  }
  if (field.enum) {
    const target = field.enum.isOpen ? warnings : errors;
    target.push(`...validateEnum(res, profileName, ${JSON.stringify(name)}, ${JSON.stringify(field.enum.values)})`);
  }
  if (field.mustSupport && !field.required)
    warnings.push(`...validateMustSupport(res, profileName, ${JSON.stringify(name)})`);
  if (field.reference && field.reference.resource.length > 0)
    errors.push(
      `...validateReference(res, profileName, ${JSON.stringify(name)}, ${JSON.stringify(field.reference.resource.map((ref) => resolveRef(ref).name))})`
    );
  if (field.slicing?.slices) {
    for (const [sliceName, slice] of Object.entries(field.slicing.slices)) {
      const match = slice.match ?? {};
      if (Object.keys(match).length === 0) continue;
      if (slice.min !== void 0 || slice.max !== void 0) {
        const min = slice.min ?? 0;
        const max = slice.max ?? 0;
        errors.push(
          `...validateSliceCardinality(res, profileName, ${JSON.stringify(name)}, ${JSON.stringify(match)}, ${JSON.stringify(sliceName)}, ${min}, ${max})`
        );
      }
      const sliceRequiredFields = [];
      const matchKeys = new Set(Object.keys(match));
      for (const rf of slice.required ?? []) {
        if (!matchKeys.has(rf)) sliceRequiredFields.push(rf);
      }
      if (tsIndex && field.type && slice.elements) {
        const cc = tsIndex.constrainedChoice(field.type.package, field.type, slice.elements);
        if (cc) sliceRequiredFields.push(cc.variant);
      }
      if (sliceRequiredFields.length > 0) {
        errors.push(
          `...validateSliceFields(res, profileName, ${JSON.stringify(name)}, ${JSON.stringify(match)}, ${JSON.stringify(sliceName)}, ${JSON.stringify(sliceRequiredFields)})`
        );
      }
    }
  }
};
var generateValidateMethod2 = (w, tsIndex, snapshot) => {
  const fields = snapshot.fields;
  const profileName = snapshot.identifier.name;
  const canonicalUrl = snapshot.identifier.url;
  const canonicalUrlExpr = canonicalUrl ? { url: canonicalUrl, expr: `${tsProfileClassName(snapshot)}.canonicalUrl` } : void 0;
  w.curlyBlock(["validate(): { errors: string[]; warnings: string[] }"], () => {
    w.line(`const profileName = "${profileName}"`);
    w.line("const res = this.resource");
    const errors = [];
    const warnings = [];
    for (const [name, field] of Object.entries(fields)) {
      if (isChoiceInstanceField(field)) continue;
      if (isChoiceDeclarationField(field)) {
        if (field.required)
          errors.push(`...validateChoiceRequired(res, profileName, ${JSON.stringify(field.choices)})`);
        if (field.prohibited?.length)
          errors.push(`...validateChoiceProhibited(res, profileName, ${JSON.stringify(field.prohibited)})`);
        continue;
      }
      collectRegularFieldValidation(
        errors,
        warnings,
        name,
        field,
        tsIndex.findLastSpecializationByIdentifier,
        canonicalUrlExpr,
        tsIndex
      );
    }
    for (const inheritedName of snapshot.inheritedRequiredFields ?? []) {
      errors.push(`...validateRequired(res, profileName, ${JSON.stringify(inheritedName)})`);
    }
    const emitArray = (label, exprs) => {
      if (exprs.length === 0) {
        w.line(`${label}: [],`);
      } else {
        w.squareBlock([`${label}:`], () => {
          for (const expr of exprs) w.line(`${expr},`);
        }, [","]);
      }
    };
    w.curlyBlock(["return"], () => {
      emitArray("errors", errors);
      emitArray("warnings", warnings);
    });
  });
  w.line();
};

// src/api/writer-generator/typescript/profile.ts
var choiceClearMethodName = (choiceOf) => `clear${uppercaseFirstLetter(tsCamelCase(choiceOf))}`;
var collectChoiceAccessors = (snapshot, promotedChoices) => {
  const variantsByChoice = {};
  for (const [name, field] of Object.entries(snapshot.fields)) {
    if (field.excluded) continue;
    if (!isChoiceInstanceField(field)) continue;
    (variantsByChoice[field.choiceOf] ??= []).push(name);
  }
  const accessors = [];
  for (const [name, field] of Object.entries(snapshot.fields)) {
    if (field.excluded) continue;
    if (!isChoiceInstanceField(field)) continue;
    if (promotedChoices.has(name)) continue;
    const tsType = tsTypeFromIdentifier(field.type) + (field.array ? "[]" : "");
    const hasSiblings = (variantsByChoice[field.choiceOf]?.length ?? 0) > 1;
    const choiceClearMethod = hasSiblings ? choiceClearMethodName(field.choiceOf) : void 0;
    accessors.push({ name, tsType, typeId: field.type, choiceClearMethod });
  }
  const choiceClearMethods = Object.entries(variantsByChoice).filter(([, variants]) => variants.length > 1).map(([choiceOf, variants]) => ({
    method: choiceClearMethodName(choiceOf),
    variants: variants.map(tsFieldName)
  }));
  return { accessors, choiceClearMethods };
};
var tryPromoteChoice2 = (field, fields, params, promotedChoices, resolveRef, isFamilyType) => {
  if (!isChoiceDeclarationField(field) || !field.required || field.choices.length !== 1) return;
  const choiceName = field.choices[0];
  if (!choiceName) return;
  const choiceField = fields[choiceName];
  if (!choiceField || !isChoiceInstanceField(choiceField)) return;
  const tsType = fieldTsType(choiceField, resolveRef, isFamilyType);
  params.push({ name: choiceName, tsType, typeId: choiceField.type });
  promotedChoices.add(choiceName);
};
var mkIsFamilyType = (tsIndex) => (ref) => {
  const schema = tsIndex.resolveType(ref);
  if (!schema || !("typeFamily" in schema)) return false;
  return (schema.typeFamily?.resources?.length ?? 0) > 0;
};
var collectProfileFactoryInfo2 = (tsIndex, snapshot) => {
  const autoFields = [];
  const sliceAutoFields = [];
  const params = [];
  const autoAccessors = [];
  const fixedFields = /* @__PURE__ */ new Set();
  const fields = snapshot.fields;
  const promotedChoices = /* @__PURE__ */ new Set();
  const resolveRef = tsIndex.findLastSpecializationByIdentifier;
  const isFamilyType = mkIsFamilyType(tsIndex);
  if (isResourceIdentifier(snapshot.base)) {
    autoFields.push({ name: "resourceType", value: JSON.stringify(snapshot.base.name) });
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.excluded) continue;
    if (isChoiceInstanceField(field)) continue;
    if (isChoiceDeclarationField(field)) {
      tryPromoteChoice2(field, fields, params, promotedChoices, resolveRef, isFamilyType);
      continue;
    }
    if (field.valueConstraint) {
      const value = JSON.stringify(field.valueConstraint.value);
      autoFields.push({ name, value: field.array ? `[${value}]` : value });
      fixedFields.add(name);
      if (isNotChoiceDeclarationField(field) && field.type) {
        const tsType = fieldTsType(field, resolveRef, isFamilyType);
        autoAccessors.push({ name, tsType, typeId: field.type });
      }
      continue;
    }
    if (isNotChoiceDeclarationField(field)) {
      const sliceNames = collectRequiredSliceNames2(field);
      if (sliceNames) {
        if (field.type) {
          const tsType = fieldTsType(field, resolveRef, isFamilyType);
          sliceAutoFields.push({
            name,
            tsType,
            typeId: field.type,
            sliceNames
          });
          autoAccessors.push({ name, tsType, typeId: field.type });
        }
        continue;
      }
    }
    if (field.required) {
      const tsType = fieldTsType(field, resolveRef, isFamilyType);
      params.push({ name, tsType, typeId: field.type });
    }
  }
  collectBaseRequiredParams2(
    tsIndex,
    snapshot,
    resolveRef,
    params,
    [
      ...autoFields.map((f) => f.name),
      ...sliceAutoFields.map((f) => f.name),
      ...params.map((f) => f.name),
      ...promotedChoices
    ],
    isFamilyType
  );
  const { accessors: choiceAccessors, choiceClearMethods } = collectChoiceAccessors(snapshot, promotedChoices);
  const accessors = [...autoAccessors, ...choiceAccessors];
  return { autoFields, sliceAutoFields, params, accessors, choiceClearMethods, fixedFields };
};
var collectBaseRequiredParams2 = (tsIndex, snapshot, resolveRef, params, coveredNames, isFamilyType) => {
  const covered = new Set(coveredNames);
  const baseSchema = tsIndex.resolveType(snapshot.base);
  if (!baseSchema || !("fields" in baseSchema) || !baseSchema.fields) return;
  for (const [name, field] of Object.entries(baseSchema.fields)) {
    if (covered.has(name)) continue;
    if (!field.required) continue;
    if (isChoiceInstanceField(field)) continue;
    if (isChoiceDeclarationField(field)) continue;
    if (isNotChoiceDeclarationField(field) && field.type) {
      const tsType = fieldTsType(field, resolveRef, isFamilyType);
      params.push({ name, tsType, typeId: field.type });
    }
  }
};
var generateProfileIndexFile = (w, tsIndex, snapshots) => {
  if (snapshots.length === 0) return;
  w.cd("profiles", () => {
    w.cat("index.ts", () => {
      const exports$1 = /* @__PURE__ */ new Map();
      for (const snapshot of snapshots) {
        const className = tsProfileClassName(snapshot);
        const moduleName = tsProfileModuleName(tsIndex, snapshot);
        if (!exports$1.has(className)) {
          exports$1.set(className, `export { ${className} } from "./${moduleName}"`);
        }
      }
      for (const exp of [...exports$1.values()].sort()) {
        w.lineSM(exp);
      }
    });
  });
};
var generateProfileHelpersImport = (w, tsIndex, snapshot, sliceDefs, factoryInfo) => {
  const extensions = snapshot.extensions ?? [];
  const hasMeta = tsIndex.isWithMetaField(snapshot);
  const canonicalUrl = snapshot.identifier.url;
  const imports = [];
  if (snapshot.base.name === "Extension" && canonicalUrl && collectSubExtensionSlices(snapshot).length > 0)
    imports.push("isRawExtensionInput");
  if (canonicalUrl && hasMeta) imports.push("ensureProfile");
  if (factoryInfo.autoFields.some((f) => f.name !== "resourceType")) imports.push("applyFixedValue");
  if (sliceDefs.length > 0 || factoryInfo.sliceAutoFields.length > 0)
    imports.push("applySliceMatch", "matchesValue", "setArraySlice", "getArraySlice", "ensureSliceDefaults");
  const hasUnboundedSlice = sliceDefs.some((s) => s.array && (s.max === 0 || s.max === void 0));
  if (hasUnboundedSlice) imports.push("setArraySliceAll", "getArraySliceAll");
  if (extensions.some((ext) => ext.path.split(".").some((s) => s !== "extension"))) imports.push("ensurePath");
  if (extensions.some((ext) => ext.isComplex && ext.subExtensions)) imports.push("extractComplexExtension");
  if (sliceDefs.some((s) => s.constrainedChoice)) imports.push("wrapSliceChoice", "unwrapSliceChoice");
  if (extensions.some((ext) => ext.url)) {
    imports.push("isExtension", "getExtensionValue", "pushExtension");
    if (extensions.some((ext) => ext.url && ext.max === "1")) imports.push("upsertExtension");
  }
  if (Object.keys(snapshot.fields).length > 0 || (snapshot.inheritedRequiredFields?.length ?? 0) > 0)
    imports.push(
      "validateRequired",
      "validateExcluded",
      "validateFixedValue",
      "validateSliceCardinality",
      "validateSliceFields",
      "validateEnum",
      "validateReference",
      "validateChoiceRequired",
      "validateChoiceProhibited",
      "validateMustSupport"
    );
  if (imports.length > 0) {
    w.tsImport("../../profile-helpers", ...imports);
    w.line();
  }
};
var generateProfileImports = (w, tsIndex, snapshot) => {
  const usedTypes = /* @__PURE__ */ new Map();
  const getModulePath = (typeId) => {
    if (isNestedIdentifier(typeId)) {
      const path = tsNameFromCanonical(typeId.url, true);
      if (path) return `../../${tsPackageDir(typeId.package)}/${pascalCase(path)}`;
    }
    return `../../${tsModulePath(typeId)}`;
  };
  const addType = (typeId) => {
    if (typeId.kind === "primitive-type") return;
    const tsName = tsResourceName(typeId);
    if (!usedTypes.has(tsName)) {
      usedTypes.set(tsName, { importPath: getModulePath(typeId), tsName });
    }
  };
  addType(snapshot.base);
  collectTypesFromSlices(tsIndex, snapshot, addType);
  const needsExtensionType = collectTypesFromExtensions(tsIndex, snapshot, addType);
  collectTypesFromFlatInput(tsIndex, snapshot, addType);
  const factoryInfo = collectProfileFactoryInfo2(tsIndex, snapshot);
  for (const param of factoryInfo.params) addType(param.typeId);
  for (const f of factoryInfo.sliceAutoFields) addType(f.typeId);
  for (const accessor of factoryInfo.accessors) addType(accessor.typeId);
  if (needsExtensionType) {
    const extensionUrl = "http://hl7.org/fhir/StructureDefinition/Extension";
    const extensionSchema = tsIndex.resolveByUrl(snapshot.identifier.package, extensionUrl);
    if (extensionSchema) addType(extensionSchema.identifier);
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const { importPath, tsName } of usedTypes.values()) {
    let names = grouped.get(importPath);
    if (!names) {
      names = [];
      grouped.set(importPath, names);
    }
    names.push(tsName);
  }
  const sortedModules = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [importPath, names] of sortedModules) {
    w.tsImport(importPath, ...names.sort(), { typeOnly: true });
  }
  if (sortedModules.length > 0) w.line();
  const extProfileImports = /* @__PURE__ */ new Map();
  for (const ext of snapshot.extensions ?? []) {
    if (!ext.url) continue;
    const info = resolveExtensionProfile2(tsIndex, snapshot.identifier.package, ext.url);
    if (!info) continue;
    if (!extProfileImports.has(info.className)) {
      const hasFlatInput = collectSubExtensionSlices(info.snapshot).length > 0;
      extProfileImports.set(info.className, { modulePath: info.modulePath, hasFlatInput });
    }
  }
  for (const [className, { modulePath, hasFlatInput }] of [...extProfileImports.entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const imports = [className, ...hasFlatInput ? [`type ${className}Flat`] : []];
    w.tsImport(modulePath, ...imports);
  }
  if (extProfileImports.size > 0) w.line();
};
var generateStaticSliceFields2 = (w, sliceDefs) => {
  for (const sliceDef of sliceDefs) {
    const staticName = `${tsSliceStaticName(sliceDef.sliceName)}SliceMatch`;
    const json = JSON.stringify(sliceDef.match);
    const prefix = `private static readonly ${staticName}: Record<string, unknown> = `;
    if (prefix.length + json.length <= (w.opts.lineWidth ?? 120)) {
      w.lineSM(`${prefix}${json}`);
    } else {
      w.curlyBlock([prefix.trimEnd()], () => {
        for (const [key, value] of Object.entries(sliceDef.match)) {
          w.line(`${JSON.stringify(key)}: ${JSON.stringify(value)},`);
        }
      });
    }
  }
  if (sliceDefs.length > 0) w.line();
};
var generateFactoryMethods = (w, tsIndex, snapshot, factoryInfo) => {
  const profileClassName = tsProfileClassName(snapshot);
  const tsBaseResourceName = tsTypeFromIdentifier(snapshot.base);
  const hasMeta = tsIndex.isWithMetaField(snapshot);
  const hasParams = factoryInfo.params.length > 0 || factoryInfo.sliceAutoFields.length > 0;
  const createArgsTypeName = `${profileClassName}Raw`;
  const paramSignature = hasParams ? `args: ${createArgsTypeName}` : "";
  const allFields = [
    ...factoryInfo.autoFields.map((f) => ({ name: f.name, value: f.value })),
    ...factoryInfo.sliceAutoFields.map((f) => ({ name: f.name, value: `${f.name}WithDefaults` })),
    ...factoryInfo.params.map((p) => ({ name: p.name, value: `args.${p.name}` }))
  ];
  w.curlyBlock(["constructor", `(resource: ${tsBaseResourceName})`], () => {
    w.lineSM("this.resource = resource");
  });
  w.line();
  w.curlyBlock(["static", "from", `(resource: ${tsBaseResourceName})`, `: ${profileClassName}`], () => {
    if (hasMeta) {
      w.curlyBlock(["if", `(!resource.meta?.profile?.includes(${profileClassName}.canonicalUrl))`], () => {
        w.line(
          `throw new Error(\`${profileClassName}: meta.profile must include \${${profileClassName}.canonicalUrl}\`)`
        );
      });
    }
    w.lineSM(`const profile = new ${profileClassName}(resource)`);
    w.lineSM("const { errors } = profile.validate()");
    w.line(`if (errors.length > 0) throw new Error(errors.join("; "))`);
    w.lineSM("return profile");
  });
  w.line();
  const canEmitIs = hasMeta && isResourceIdentifier(snapshot.base) || snapshot.base.name === "Extension";
  if (canEmitIs) {
    w.curlyBlock(["static", "is", "(resource: unknown)", `: resource is ${tsBaseResourceName}`], () => {
      w.line(`if (typeof resource !== "object" || resource === null) return false;`);
      if (hasMeta && isResourceIdentifier(snapshot.base)) {
        w.line(`const r = resource as { resourceType?: string; meta?: { profile?: string[] } };`);
        w.line(`if (r.resourceType !== ${JSON.stringify(snapshot.base.name)}) return false;`);
        w.lineSM(`return (r.meta?.profile ?? []).includes(${profileClassName}.canonicalUrl)`);
      } else {
        w.lineSM(`return (resource as { url?: string }).url === ${profileClassName}.canonicalUrl`);
      }
    });
    w.line();
  }
  w.curlyBlock(["static", "apply", `(resource: ${tsBaseResourceName})`, `: ${profileClassName}`], () => {
    if (hasMeta) {
      w.lineSM(`ensureProfile(resource, ${profileClassName}.canonicalUrl)`);
    }
    if (snapshot.base.name === "Extension" && snapshot.identifier.url) {
      w.lineSM(`resource.url = ${profileClassName}.canonicalUrl`);
    }
    const applyAutoFields = factoryInfo.autoFields.filter((f) => f.name !== "resourceType");
    if (applyAutoFields.length > 0) {
      for (const f of applyAutoFields) {
        w.lineSM(`applyFixedValue(resource, ${JSON.stringify(f.name)}, ${f.value})`);
      }
    }
    for (const f of factoryInfo.sliceAutoFields) {
      const matchRefs = f.sliceNames.map((s) => `${profileClassName}.${tsSliceStaticName(s)}SliceMatch`);
      w.line(`resource.${f.name} = ensureSliceDefaults(`);
      w.indentBlock(() => {
        w.line(`[...(resource.${f.name} ?? [])],`);
        for (const ref of matchRefs) {
          w.line(`${ref},`);
        }
      });
      w.lineSM(")");
    }
    w.lineSM(`return new ${profileClassName}(resource)`);
  });
  w.line();
  const subSlicesForInput = snapshot.base.name === "Extension" ? collectSubExtensionSlices(snapshot) : [];
  const hasInputHelper = subSlicesForInput.length > 0;
  if (hasInputHelper) {
    const rawInputTypeName = `${profileClassName}Raw`;
    const inputTypeName = `${profileClassName}Flat`;
    w.curlyBlock(
      ["private static", "resolveInput", `(args: ${rawInputTypeName} | ${inputTypeName})`, ": Extension[]"],
      () => {
        w.ifElseChain(
          [
            {
              cond: `isRawExtensionInput<${rawInputTypeName}>(args)`,
              body: () => w.lineSM("return args.extension ?? []")
            }
          ],
          () => {
            w.lineSM("const result: Extension[] = []");
            for (const sub of subSlicesForInput) {
              if (sub.isArray) {
                w.curlyBlock(["if", `(args.${sub.name})`], () => {
                  w.curlyBlock(["for", `(const item of args.${sub.name})`], () => {
                    w.lineSM(
                      `result.push({ url: "${sub.url}", ${sub.valueField}: item } as Extension)`
                    );
                  });
                });
              } else {
                w.curlyBlock(["if", `(args.${sub.name} !== undefined)`], () => {
                  w.lineSM(
                    `result.push({ url: "${sub.url}", ${sub.valueField}: args.${sub.name} } as Extension)`
                  );
                });
              }
            }
            w.lineSM("return result");
          }
        );
      }
    );
    w.line();
    const createResourceSig = hasParams ? `args: ${rawInputTypeName} | ${inputTypeName}` : `args?: ${rawInputTypeName} | ${inputTypeName}`;
    w.curlyBlock(["static", "createResource", `(${createResourceSig})`, `: ${tsBaseResourceName}`], () => {
      w.lineSM(`const resolvedExtensions = ${profileClassName}.resolveInput(args ?? {})`);
      const extSliceField = factoryInfo.sliceAutoFields.find((f) => f.name === "extension");
      if (extSliceField) {
        const matchRefs = extSliceField.sliceNames.map(
          (s) => `${profileClassName}.${tsSliceStaticName(s)}SliceMatch`
        );
        w.line("const extensionWithDefaults = ensureSliceDefaults(");
        w.indentBlock(() => {
          w.line("resolvedExtensions,");
          for (const ref of matchRefs) {
            w.line(`${ref},`);
          }
        });
        w.lineSM(")");
      }
      w.line();
      const extensionVar = extSliceField ? "extensionWithDefaults" : "resolvedExtensions";
      const hasMetaParam = allFields.some((f) => f.name === "meta");
      w.curlyBlock([`const resource: ${tsBaseResourceName} =`], () => {
        for (const f of allFields) {
          if (f.name === "extension") continue;
          if (f.name === "meta" && hasMeta) continue;
          w.line(`${f.name}: ${f.value},`);
        }
        w.line(`extension: ${extensionVar},`);
        if (hasMeta) {
          if (hasMetaParam) {
            w.line(
              `meta: { ...args.meta, profile: [...(args.meta?.profile ?? []), ${profileClassName}.canonicalUrl] },`
            );
          } else {
            w.line(`meta: { profile: [${profileClassName}.canonicalUrl] },`);
          }
        }
      });
      w.lineSM("return resource");
    });
    w.line();
    const createSig = hasParams ? `args: ${rawInputTypeName} | ${inputTypeName}` : `args?: ${rawInputTypeName} | ${inputTypeName}`;
    w.curlyBlock(["static", "create", `(${createSig})`, `: ${profileClassName}`], () => {
      w.lineSM(`return ${profileClassName}.apply(${profileClassName}.createResource(args))`);
    });
  } else {
    w.curlyBlock(["static", "createResource", `(${paramSignature})`, `: ${tsBaseResourceName}`], () => {
      for (const f of factoryInfo.sliceAutoFields) {
        const matchRefs = f.sliceNames.map((s) => `${profileClassName}.${tsSliceStaticName(s)}SliceMatch`);
        w.line(`const ${f.name}WithDefaults = ensureSliceDefaults(`);
        w.indentBlock(() => {
          w.line(`[...(args.${f.name} ?? [])],`);
          for (const ref of matchRefs) {
            w.line(`${ref},`);
          }
        });
        w.lineSM(")");
      }
      if (factoryInfo.sliceAutoFields.length > 0) {
        w.line();
      }
      if (isPrimitiveIdentifier(snapshot.base)) {
        w.lineSM(`const resource = undefined as unknown as ${tsBaseResourceName}`);
      } else {
        const hasMetaParam = allFields.some((f) => f.name === "meta");
        w.curlyBlock([`const resource: ${tsBaseResourceName} =`], () => {
          for (const f of allFields) {
            if (f.name === "meta" && hasMeta) continue;
            w.line(`${f.name}: ${f.value},`);
          }
          if (hasMeta) {
            if (hasMetaParam) {
              w.line(
                `meta: { ...args.meta, profile: [...(args.meta?.profile ?? []), ${profileClassName}.canonicalUrl] },`
              );
            } else {
              w.line(`meta: { profile: [${profileClassName}.canonicalUrl] },`);
            }
          }
        });
      }
      w.lineSM("return resource");
    });
    w.line();
    w.curlyBlock(["static", "create", `(${paramSignature})`, `: ${profileClassName}`], () => {
      w.lineSM(`const resource = ${profileClassName}.createResource(${hasParams ? "args" : ""})`);
      w.lineSM(`return ${profileClassName}.apply(resource)`);
    });
  }
  w.line();
  w.curlyBlock(["toResource", "()", `: ${tsBaseResourceName}`], () => {
    w.lineSM("return this.resource");
  });
  w.line();
};
var generateFieldAccessors2 = (w, factoryInfo) => {
  w.line("// Field accessors");
  for (const p of factoryInfo.params) {
    const methodBaseName = uppercaseFirstLetter(p.name);
    w.curlyBlock([`get${methodBaseName}`, "()", `: ${p.tsType} | undefined`], () => {
      w.lineSM(`return this.resource.${p.name} as ${p.tsType} | undefined`);
    });
    w.line();
    w.curlyBlock([`set${methodBaseName}`, `(value: ${p.tsType})`, ": this"], () => {
      w.lineSM(`Object.assign(this.resource, { ${p.name}: value })`);
      w.lineSM("return this");
    });
    w.line();
  }
  for (const a of factoryInfo.accessors) {
    const methodBaseName = uppercaseFirstLetter(tsCamelCase(a.name));
    const fieldAccess = tsFieldName(a.name);
    w.curlyBlock([`get${methodBaseName}`, "()", `: ${a.tsType} | undefined`], () => {
      w.lineSM(`return ${tsGet("this.resource", fieldAccess)} as ${a.tsType} | undefined`);
    });
    w.line();
    if (!factoryInfo.fixedFields.has(a.name)) {
      w.curlyBlock([`set${methodBaseName}`, `(value: ${a.tsType})`, ": this"], () => {
        if (a.choiceClearMethod) w.lineSM(`this.${a.choiceClearMethod}()`);
        w.lineSM(`Object.assign(this.resource, { ${fieldAccess}: value })`);
        w.lineSM("return this");
      });
      w.line();
    }
  }
  for (const { method, variants } of factoryInfo.choiceClearMethods) {
    w.curlyBlock([method, "()", ": void"], () => {
      for (const variant of variants) w.lineSM(`delete ${tsGet("this.resource", variant)}`);
    });
    w.line();
  }
};
var generateInlineExtensionInputTypes = (w, tsIndex, snapshot) => {
  const tsProfileName = tsResourceName(snapshot.identifier);
  const complexExtensions = (snapshot.extensions ?? []).filter((ext) => ext.isComplex && ext.subExtensions);
  for (const ext of complexExtensions) {
    if (!ext.url) continue;
    const extProfileInfo = resolveExtensionProfile2(tsIndex, snapshot.identifier.package, ext.url);
    const hasFlatInput = extProfileInfo ? collectSubExtensionSlices(extProfileInfo.snapshot).length > 0 : false;
    if (hasFlatInput) continue;
    const typeName = tsExtensionFlatTypeName(tsProfileName, ext.name);
    w.curlyBlock(["export", "type", typeName, "="], () => {
      for (const sub of ext.subExtensions ?? []) {
        const tsType = sub.valueFieldType ? tsTypeFromIdentifier(sub.valueFieldType) : "unknown";
        const isArray = sub.max === "*";
        const isRequired2 = sub.min !== void 0 && sub.min > 0;
        w.lineSM(`${sub.name}${isRequired2 ? "" : "?"}: ${tsType}${isArray ? "[]" : ""}`);
      }
    });
    w.line();
  }
};
var valueToTypeLiteral = (value) => {
  if (value === null || value === void 0) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(valueToTypeLiteral).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${valueToTypeLiteral(v)}`).join("; ");
    return `{ ${entries} }`;
  }
  return "unknown";
};
var generateSliceInputTypes = (w, snapshot, sliceDefs) => {
  if (sliceDefs.length === 0) return;
  const tsProfileName = tsResourceName(snapshot.identifier);
  for (const sliceDef of sliceDefs) {
    const inputTypeName = tsSliceFlatTypeName(tsProfileName, sliceDef.fieldName, sliceDef.sliceName);
    const flatTypeName = tsSliceFlatAllTypeName(tsProfileName, sliceDef.fieldName, sliceDef.sliceName);
    const matchFields = sliceDef.typeDiscriminator ? [] : Object.keys(sliceDef.match);
    const allExcluded = [.../* @__PURE__ */ new Set([...sliceDef.excluded, ...matchFields])];
    if (sliceDef.constrainedChoice) {
      const cc = sliceDef.constrainedChoice;
      allExcluded.push(cc.choiceBase);
      for (const name of cc.allChoiceNames) {
        if (!allExcluded.includes(name)) allExcluded.push(name);
      }
    }
    const excludedNames = allExcluded.map((name) => JSON.stringify(name));
    const requiredNames = sliceDef.required.map((name) => JSON.stringify(name));
    const baseType = sliceDef.typedBaseType;
    let inputTypeExpr = baseType;
    if (excludedNames.length > 0) {
      inputTypeExpr = `Omit<${inputTypeExpr}, ${excludedNames.join(" | ")}>`;
    }
    if (requiredNames.length > 0) {
      inputTypeExpr = `${inputTypeExpr} & Required<Pick<${baseType}, ${requiredNames.join(" | ")}>>`;
    }
    if (sliceDef.constrainedChoice) {
      inputTypeExpr = `${inputTypeExpr} & ${tsTypeFromIdentifier(sliceDef.constrainedChoice.variantType)}`;
    }
    w.lineSM(`export type ${inputTypeName} = ${inputTypeExpr}`);
    const safeMatchEntries = matchFields.length > 0 && !sliceDef.constrainedChoice ? matchFields.filter((key) => {
      const v = sliceDef.match[key];
      return Array.isArray(v) || typeof v !== "object" || v === null;
    }).map((key) => ({ key, typeLiteral: valueToTypeLiteral(sliceDef.match[key]) })) : [];
    if (safeMatchEntries.length > 0) {
      w.curlyBlock([`export type ${flatTypeName} = ${inputTypeName} &`], () => {
        for (const entry of safeMatchEntries) {
          w.lineSM(`readonly ${entry.key}: ${entry.typeLiteral}`);
        }
      });
    } else {
      w.lineSM(`export type ${flatTypeName} = ${inputTypeName}`);
    }
    w.line();
  }
};
var generateRawType = (w, snapshot, factoryInfo) => {
  const hasParams = factoryInfo.params.length > 0 || factoryInfo.sliceAutoFields.length > 0;
  const subSlices = snapshot.base.name === "Extension" ? collectSubExtensionSlices(snapshot) : [];
  if (!hasParams && subSlices.length === 0) return;
  const createArgsTypeName = `${tsProfileClassName(snapshot)}Raw`;
  w.curlyBlock(["export", "type", createArgsTypeName, "="], () => {
    for (const p of factoryInfo.params) {
      w.lineSM(`${p.name}: ${p.tsType}`);
    }
    for (const f of factoryInfo.sliceAutoFields) {
      w.lineSM(`${f.name}?: ${f.tsType}`);
    }
    const extensionCovered = factoryInfo.params.some((p) => p.name === "extension") || factoryInfo.sliceAutoFields.some((f) => f.name === "extension");
    if (subSlices.length > 0 && !extensionCovered) {
      w.lineSM("extension?: Extension[]");
    }
  });
  w.line();
};
var generateFlatInputType = (w, snapshot) => {
  const subSlices = snapshot.base.name === "Extension" ? collectSubExtensionSlices(snapshot) : [];
  if (subSlices.length === 0) return;
  const flatInputTypeName = `${tsProfileClassName(snapshot)}Flat`;
  w.curlyBlock(["export", "type", flatInputTypeName, "="], () => {
    for (const sub of subSlices) {
      const opt = sub.isRequired ? "" : "?";
      const arr = sub.isArray ? "[]" : "";
      w.lineSM(`${sub.name}${opt}: ${sub.tsType}${arr}`);
    }
  });
  w.line();
};
var generateProfileClass = (w, tsIndex, snapshot) => {
  const tsBaseResourceName = tsTypeFromIdentifier(snapshot.base);
  const profileClassName = tsProfileClassName(snapshot);
  const sliceDefs = collectSliceDefs2(tsIndex, snapshot);
  const factoryInfo = collectProfileFactoryInfo2(tsIndex, snapshot);
  generateInlineExtensionInputTypes(w, tsIndex, snapshot);
  generateSliceInputTypes(w, snapshot, sliceDefs);
  generateProfileHelpersImport(w, tsIndex, snapshot, sliceDefs, factoryInfo);
  generateRawType(w, snapshot, factoryInfo);
  generateFlatInputType(w, snapshot);
  const canonicalUrl = snapshot.identifier.url;
  w.comment("CanonicalURL:", canonicalUrl, `(pkg: ${packageMetaToFhir(packageMeta(snapshot))})`);
  w.curlyBlock(["export", "class", profileClassName], () => {
    w.lineSM(`static readonly canonicalUrl = ${JSON.stringify(canonicalUrl)}`);
    w.line();
    generateStaticSliceFields2(w, sliceDefs);
    w.lineSM(`private resource: ${tsBaseResourceName}`);
    w.line();
    generateFactoryMethods(w, tsIndex, snapshot, factoryInfo);
    generateFieldAccessors2(w, factoryInfo);
    w.line("// Extensions");
    generateExtensionMethods2(w, tsIndex, snapshot);
    w.line("// Slices");
    generateSliceSetters2(w, sliceDefs, snapshot);
    generateSliceGetters2(w, sliceDefs, snapshot);
    w.line("// Validation");
    generateValidateMethod2(w, tsIndex, snapshot);
  });
  w.line();
};

// src/api/writer-generator/typescript/writer.ts
var resolveTsAssets = (fn) => {
  const __dirname = Path5.dirname(fileURLToPath(import.meta.url));
  const __filename = fileURLToPath(import.meta.url);
  if (__filename.endsWith("dist/index.js")) {
    return Path5.resolve(__dirname, "..", "assets", "api", "writer-generator", "typescript", fn);
  }
  return Path5.resolve(__dirname, "../../../..", "assets", "api", "writer-generator", "typescript", fn);
};
var leafOf3 = (path) => path[path.length - 1] ?? "";
var TS_HARDCODED_GENERIC_NAMES = /* @__PURE__ */ new Set(["Reference", "Coding", "CodeableConcept"]);
var TypeScript = class extends Writer {
  constructor(options) {
    super({ lineWidth: 120, ...options, resolveAssets: options.resolveAssets ?? resolveTsAssets });
  }
  ifElseChain(branches, elseBody) {
    branches.forEach((branch, i) => {
      const prefix = i === 0 ? "if" : "} else if";
      this.line(`${prefix} (${branch.cond}) {`);
      this.indent();
      branch.body();
      this.deindent();
    });
    if (elseBody) {
      this.line("} else {");
      this.indent();
      elseBody();
      this.deindent();
    }
    this.line("}");
  }
  tsImport(tsPackageName, ...rest) {
    const last = rest[rest.length - 1];
    const typeOnly = typeof last === "object" ? last.typeOnly : false;
    const entities = typeof last === "object" ? rest.slice(0, -1) : rest;
    const keyword = typeOnly ? "import type" : "import";
    const singleLine = `${keyword} { ${entities.join(", ")} } from "${tsPackageName}"`;
    if (singleLine.length <= (this.opts.lineWidth ?? 120)) {
      this.lineSM(singleLine);
    } else {
      this.curlyBlock([keyword], () => {
        for (const entity of entities) {
          this.line(`${entity},`);
        }
      }, [` from "${tsPackageName}";`]);
    }
  }
  generateFhirPackageIndexFile(schemas) {
    this.cat("index.ts", () => {
      const profiles = schemas.filter(isSnapshotProfileTypeSchema);
      if (profiles.length > 0) {
        this.lineSM(`export * from "./profiles"`);
      }
      let exports$1 = schemas.flatMap((schema) => {
        const resourceName = tsResourceName(schema.identifier);
        const typeExports = isSnapshotProfileTypeSchema(schema) ? [] : [
          resourceName,
          ...isResourceTypeSchema(schema) && schema.nested || isLogicalTypeSchema(schema) && schema.nested ? schema.nested.map((n) => tsResourceName(n.identifier)) : []
        ];
        const valueExports = isResourceTypeSchema(schema) ? [`is${resourceName}`] : [];
        return [
          {
            identifier: schema.identifier,
            tsPackageName: tsModuleName(schema.identifier),
            resourceName,
            typeExports,
            valueExports
          }
        ];
      }).sort((a, b) => a.resourceName.localeCompare(b.resourceName));
      exports$1 = Array.from(new Map(exports$1.map((exp) => [exp.resourceName.toLowerCase(), exp])).values()).sort(
        (a, b) => a.resourceName.localeCompare(b.resourceName)
      );
      for (const exp of exports$1) {
        this.debugComment(exp.identifier);
        if (exp.typeExports.length > 0) {
          this.lineSM(`export type { ${exp.typeExports.join(", ")} } from "./${exp.tsPackageName}"`);
        }
        if (exp.valueExports.length > 0) {
          this.lineSM(`export { ${exp.valueExports.join(", ")} } from "./${exp.tsPackageName}"`);
        }
      }
    });
  }
  generateDependenciesImports(tsIndex, schema, importPrefix = "../") {
    if (schema.dependencies) {
      const imports = [];
      const skipped = [];
      for (const dep of schema.dependencies) {
        if (["complex-type", "resource", "logical"].includes(dep.kind)) {
          imports.push({
            tsPackage: `${importPrefix}${tsModulePath(dep)}`,
            name: tsResourceName(dep),
            dep
          });
        } else {
          skipped.push(dep);
        }
      }
      imports.sort((a, b) => a.name.localeCompare(b.name));
      for (const dep of imports) {
        this.debugComment(dep.dep);
        this.tsImport(dep.tsPackage, dep.name, { typeOnly: true });
      }
      for (const dep of skipped) {
        this.debugComment("skip:", dep);
      }
      this.line();
      if (this.withPrimitiveTypeExtension(schema) && schema.identifier.name !== "Element" && schema.dependencies.find((e) => e.name === "Element") === void 0) {
        const elementUrl = "http://hl7.org/fhir/StructureDefinition/Element";
        const element = tsIndex.resolveByUrl(schema.identifier.package, elementUrl);
        if (!element) throw new Error(`'${elementUrl}' not found for ${schema.identifier.package}.`);
        this.tsImport(`${importPrefix}${tsModulePath(element.identifier)}`, "Element", { typeOnly: true });
      }
    }
  }
  generateComplexTypeReexports(schema) {
    const complexTypeDeps = schema.dependencies?.filter(isComplexTypeIdentifier);
    if (complexTypeDeps && complexTypeDeps.length > 0) {
      for (const dep of complexTypeDeps) {
        this.debugComment(dep);
        this.lineSM(`export type { ${tsResourceName(dep)} } from "${`../${tsModulePath(dep)}`}"`);
      }
      this.line();
    }
  }
  addFieldExtension(fieldName, isArray) {
    const extFieldName = tsFieldName(`_${fieldName}`);
    const typeExpr = isArray ? "(Element | null)[]" : "Element";
    this.lineSM(`${extFieldName}?: ${typeExpr}`);
  }
  generateType(tsIndex, schema, isFamilyType) {
    let name;
    const genericTypes = ["Reference", "Coding", "CodeableConcept"];
    const isHardcodedGeneric = genericTypes.includes(schema.identifier.name);
    if (isHardcodedGeneric) {
      name = `${schema.identifier.name}<T extends string = string>`;
    } else {
      name = tsResourceName(schema.identifier);
    }
    const params = isHardcodedGeneric ? [] : schema.generic?.params ?? [];
    const fieldMap = {};
    const nestedArgsByField = {};
    if (!isHardcodedGeneric) {
      for (const [fieldName, field] of Object.entries(schema.fields ?? {})) {
        if (isChoiceDeclarationField(field) || !field.type) continue;
        const target = tsIndex.resolveType(field.type);
        if (!target || TS_HARDCODED_GENERIC_NAMES.has(target.identifier.name)) continue;
        const tsName = tsFieldName(fieldName);
        const targetParams = isNestedTypeSchema(target) || isSpecializationTypeSchema(target) ? target.generic?.params : void 0;
        if (targetParams?.length) {
          const args = targetParams.map(
            (tp) => params.find((q) => leafOf3(q.path) === leafOf3(tp.path))?.typeVar ?? tp.typeVar
          );
          nestedArgsByField[tsName] = `<${args.join(", ")}>`;
        } else if (isSpecializationTypeSchema(target) && (target.typeFamily?.resources?.length ?? 0) > 0) {
          const p = params.find((q) => leafOf3(q.path) === fieldName);
          if (p) fieldMap[tsName] = p.typeVar;
        }
      }
    }
    if (!isHardcodedGeneric && params.length > 0) {
      const declParams = params.map((p) => `${p.typeVar} extends ${p.constraint.name} = ${p.constraint.name}`);
      name += `<${declParams.join(", ")}>`;
    }
    let extendsClause;
    if (schema.base) extendsClause = `extends ${tsNameFromCanonical(schema.base.url)}`;
    this.debugComment(schema.identifier);
    if (!schema.fields && !extendsClause && !isResourceTypeSchema(schema)) {
      this.lineSM(`export type ${name} = object`);
      return;
    }
    this.curlyBlock(["export", "interface", name, extendsClause], () => {
      if (isResourceTypeSchema(schema)) {
        const possibleResourceTypes = [schema.identifier, ...schema.typeFamily?.resources ?? []];
        const openSetSuffix = this.opts.openResourceTypeSet && possibleResourceTypes.length > 1 ? " | string" : "";
        this.lineSM(
          `resourceType: ${possibleResourceTypes.sort((a, b) => a.name.localeCompare(b.name)).map((e) => `"${e.name}"`).join(" | ")}${openSetSuffix}`
        );
        this.line();
      }
      if (!schema.fields) return;
      const fields = Object.entries(schema.fields).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [fieldName, field] of fields) {
        if (isChoiceDeclarationField(field)) continue;
        if (!field.type) continue;
        this.debugComment(fieldName, ":", field);
        const tsName = tsFieldName(fieldName);
        const tsType = resolveFieldTsType(
          schema.identifier.name,
          tsName,
          field,
          void 0,
          fieldMap,
          isFamilyType
        );
        const optionalSymbol = field.required ? "" : "?";
        const arraySymbol = field.array ? "[]" : "";
        const nestedArgs = nestedArgsByField[tsName] ?? "";
        this.lineSM(`${tsName}${optionalSymbol}: ${tsType}${nestedArgs}${arraySymbol}`);
        if (this.withPrimitiveTypeExtension(schema)) {
          if (isPrimitiveIdentifier(field.type)) {
            this.addFieldExtension(fieldName, field.array ?? false);
          }
        }
      }
    });
  }
  withPrimitiveTypeExtension(schema) {
    if (!this.opts.primitiveTypeExtension) return false;
    if (!isSpecializationTypeSchema(schema)) return false;
    for (const field of Object.values(schema.fields ?? {})) {
      if (isChoiceDeclarationField(field)) continue;
      if (isPrimitiveIdentifier(field.type)) return true;
    }
    return false;
  }
  generateResourceTypePredicate(schema) {
    if (!isResourceTypeSchema(schema)) return;
    const name = tsResourceName(schema.identifier);
    this.curlyBlock(["export", "const", `is${name}`, "=", `(resource: unknown): resource is ${name}`, "=>"], () => {
      this.lineSM(
        `return resource !== null && typeof resource === "object" && (resource as {resourceType: string}).resourceType === "${schema.identifier.name}"`
      );
    });
  }
  generateNestedTypes(tsIndex, schema, isFamilyType) {
    if (!schema.nested) return;
    for (const subtype of schema.nested) {
      this.generateType(tsIndex, subtype, isFamilyType);
      this.line();
    }
  }
  generateResourceModule(tsIndex, schema) {
    if (isSnapshotProfileTypeSchema(schema)) {
      this.cd("profiles", () => {
        this.cat(`${tsProfileModuleFileName(tsIndex, schema)}`, () => {
          this.generateDisclaimer();
          generateProfileImports(this, tsIndex, schema);
          generateProfileClass(this, tsIndex, schema);
        });
      });
    } else if (isSpecializationTypeSchema(schema)) {
      const isFamilyType = mkIsFamilyType(tsIndex);
      this.cat(`${tsModuleFileName(schema.identifier)}`, () => {
        this.generateDisclaimer();
        this.generateDependenciesImports(tsIndex, schema);
        this.generateComplexTypeReexports(schema);
        this.generateNestedTypes(tsIndex, schema, isFamilyType);
        this.comment(
          "CanonicalURL:",
          schema.identifier.url,
          `(pkg: ${packageMetaToFhir(packageMeta(schema))})`
        );
        this.generateType(tsIndex, schema, isFamilyType);
        this.generateResourceTypePredicate(schema);
      });
    } else {
      throw new Error(`Profile generation not implemented for kind: ${schema.identifier.kind}`);
    }
  }
  async generate(tsIndex) {
    const typesToGenerate = [
      ...tsIndex.collectComplexTypes(),
      ...tsIndex.collectResources(),
      ...tsIndex.collectLogicalModels(),
      ...this.opts.generateProfile ? tsIndex.collectSnapshotProfiles() : []
    ];
    const grouped = groupByPackages(typesToGenerate);
    const hasProfiles = this.opts.generateProfile && typesToGenerate.some(isSnapshotProfileTypeSchema);
    this.cd("/", () => {
      if (hasProfiles) {
        this.cp("profile-helpers.ts", "profile-helpers.ts");
      }
      for (const [packageName, packageSchemas] of Object.entries(grouped)) {
        const packageDir = tsPackageDir(packageName);
        this.cd(packageDir, () => {
          for (const schema of packageSchemas) {
            this.generateResourceModule(tsIndex, schema);
          }
          generateProfileIndexFile(this, tsIndex, packageSchemas.filter(isSnapshotProfileTypeSchema));
          this.generateFhirPackageIndexFile(packageSchemas);
        });
      }
    });
  }
};

// src/api/builder.ts
function countLinesByMatches(text) {
  if (text === "") return 0;
  const m = text.match(/\n/g);
  return m ? m.length + 1 : 1;
}
var formatLoc = (loc) => {
  if (loc >= 1e4) return `${Math.round(loc / 1e3)} kloc`;
  if (loc >= 1e3) return `${(loc / 1e3).toFixed(1)} kloc`;
  return `${loc} loc`;
};
var prettyReport = (report, options = {}) => {
  const { success, filesGenerated, errors, warnings, duration } = report;
  const fileLimit = options.fileLimit ?? 20;
  const errorsStr = errors.length > 0 ? `Errors: ${errors.join(", ")}` : void 0;
  const warningsStr = warnings.length > 0 ? `Warnings: ${warnings.join(", ")}` : void 0;
  let totalFiles = 0;
  let totalLoc = 0;
  const aggregateByDir = (files) => {
    const byDir = {};
    for (const [p, loc] of Object.entries(files)) {
      const dir = Path5.dirname(p);
      byDir[dir] ??= { count: 0, loc: 0 };
      byDir[dir].count += 1;
      byDir[dir].loc += loc;
    }
    return Object.entries(byDir).map(([dir, v]) => ({ dir, count: v.count, loc: v.loc })).sort((a, b) => a.dir.localeCompare(b.dir));
  };
  const groupStrs = Object.entries(filesGenerated).map(([name, files]) => {
    const locByPath = {};
    let groupLoc = 0;
    for (const [path, content] of Object.entries(files)) {
      const loc = countLinesByMatches(content);
      locByPath[path] = loc;
      groupLoc += loc;
    }
    const count = Object.keys(files).length;
    totalFiles += count;
    totalLoc += groupLoc;
    const header = `  ${name} (${count} files, ${formatLoc(groupLoc)}):`;
    if (count === 0) return header;
    if (count > fileLimit) {
      const dirs = aggregateByDir(locByPath);
      const dirLines = dirs.map((d) => `    - ${d.dir}/ (${d.count} files, ${formatLoc(d.loc)})`).join("\n");
      return `${header}
${dirLines}`;
    }
    const fileLines = Object.entries(locByPath).map(([p, loc]) => `    - ${p} (${loc} loc)`).join("\n");
    return `${header}
${fileLines}`;
  });
  return [
    `Generated files (${totalFiles} files, ${formatLoc(totalLoc)}):`,
    ...groupStrs,
    errorsStr,
    warningsStr,
    `Duration: ${Math.round(duration)}ms`,
    `Status: ${success ? "\u{1F7E9} Success" : "\u{1F7E5} Failure"}`
  ].filter((e) => e).join("\n");
};
var cleanup = async (opts, logger) => {
  logger.info(`Cleaning outputs...`);
  try {
    logger.info(`Clean ${opts.outputDir}`);
    fs.rmSync(opts.outputDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`Error cleaning output directory: ${error instanceof Error ? error.message : String(error)}`);
  }
};
var APIBuilder = class {
  options;
  manager;
  prebuiltRegister;
  managerInput;
  logger;
  generators = [];
  constructor(userOpts = {}) {
    const defaultOpts = {
      outputDir: "./generated",
      cleanOutput: true,
      throwException: false,
      registry: void 0,
      dropCanonicalManagerCache: false
    };
    const apiBuilderKeys = [
      "outputDir",
      "cleanOutput",
      "throwException",
      "typeSchema",
      "registry",
      "dropCanonicalManagerCache"
    ];
    const opts = {
      ...defaultOpts,
      ...Object.fromEntries(apiBuilderKeys.filter((k) => userOpts[k] !== void 0).map((k) => [k, userOpts[k]]))
    };
    if (userOpts.manager && userOpts.register) {
      throw new Error("Cannot provide both 'manager' and 'register' options. Use one or the other.");
    }
    this.managerInput = {
      npmPackages: [],
      localSDs: [],
      localTgzPackages: []
    };
    this.prebuiltRegister = userOpts.register;
    this.manager = userOpts.manager ?? CanonicalManager({
      packages: [],
      workingDir: ".codegen-cache/canonical-manager-cache",
      registry: userOpts.registry,
      dropCache: userOpts.dropCanonicalManagerCache,
      preprocessPackage: userOpts.preprocessPackage,
      ignorePackageIndex: userOpts.ignorePackageIndex
    });
    this.logger = userOpts.logger ?? mkLogger({ prefix: "api" });
    this.options = opts;
  }
  fromPackage(packageName, version) {
    const pkg = packageMetaToNpm({ name: packageName, version: version || "latest" });
    this.managerInput.npmPackages.push(pkg);
    return this;
  }
  fromPackageRef(packageRef) {
    this.managerInput.npmPackages.push(packageRef);
    return this;
  }
  localStructureDefinitions(config) {
    this.logger.info(`Registering local StructureDefinitions for ${config.package.name}@${config.package.version}`);
    this.managerInput.localSDs.push({
      name: config.package.name,
      version: config.package.version,
      path: config.path,
      dependencies: config.dependencies?.map((dep) => packageMetaToNpm(dep))
    });
    return this;
  }
  localTgzPackage(archivePath) {
    this.logger.info(`Registering local tgz package: ${archivePath}`);
    this.managerInput.localTgzPackages.push({ archivePath: Path5.resolve(archivePath) });
    return this;
  }
  introspection(userOpts) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: this.options.outputDir,
      inMemoryOnly: false
    };
    const opts = {
      ...defaultWriterOpts,
      ...Object.fromEntries(Object.entries(userOpts ?? {}).filter(([_, v]) => v !== void 0))
    };
    const writer = new IntrospectionWriter(opts);
    this.generators.push({ name: "introspection", writer });
    this.logger.debug(`Configured introspection generator (${JSON.stringify(opts, void 0, 2)})`);
    return this;
  }
  typescript(userOpts) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: Path5.join(this.options.outputDir, "/types"),
      tabSize: 4,
      withDebugComment: false,
      commentLinePrefix: "//",
      generateProfile: true
    };
    const defaultTsOpts = {
      ...defaultWriterOpts,
      openResourceTypeSet: false,
      primitiveTypeExtension: true
    };
    const opts = {
      ...defaultTsOpts,
      ...Object.fromEntries(Object.entries(userOpts).filter(([_, v]) => v !== void 0))
    };
    const generator = new TypeScript(opts);
    this.generators.push({ name: "typescript", writer: generator });
    this.logger.debug(`Configured TypeScript generator (${JSON.stringify(opts, void 0, 2)})`);
    return this;
  }
  python(userOptions) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: this.options.outputDir,
      tabSize: 4,
      withDebugComment: false,
      commentLinePrefix: "#"
    };
    const defaultPyOpts = {
      ...defaultWriterOpts,
      rootPackageName: "fhir_types",
      fieldFormat: "camelCase",
      primitiveTypeExtension: false
    };
    const opts = {
      ...defaultPyOpts,
      ...Object.fromEntries(Object.entries(userOptions).filter(([_, v]) => v !== void 0))
    };
    const generator = new Python(opts);
    this.generators.push({ name: "python", writer: generator });
    this.logger.debug(`Configured python generator`);
    return this;
  }
  mustache(templatePath, userOpts) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: this.options.outputDir
    };
    const defaultMustacheOpts = {
      meta: {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        generator: "atomic-codegen"
      }
    };
    const opts = {
      ...defaultWriterOpts,
      ...defaultMustacheOpts,
      ...userOpts
    };
    const generator = createGenerator(templatePath, opts);
    this.generators.push({ name: `mustache[${templatePath}]`, writer: generator });
    this.logger.debug(`Configured TypeScript generator (${JSON.stringify(opts, void 0, 2)})`);
    return this;
  }
  csharp(userOptions) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: Path5.join(this.options.outputDir, "/types"),
      tabSize: 4,
      withDebugComment: false,
      commentLinePrefix: "//"
    };
    const defaultCSharpOpts = {
      ...defaultWriterOpts,
      rootNamespace: "Fhir.Types"
    };
    const opts = {
      ...defaultCSharpOpts,
      ...Object.fromEntries(Object.entries(userOptions).filter(([_, v]) => v !== void 0))
    };
    const generator = new CSharp(opts);
    this.generators.push({ name: "csharp", writer: generator });
    this.logger.debug(`Configured C# generator`);
    return this;
  }
  /**
   * Set the output directory for all generators
   */
  outputTo(directory) {
    this.logger.debug(`Setting output directory: ${directory}`);
    this.options.outputDir = directory;
    for (const gen of this.generators) {
      gen.writer.setOutputDir(directory);
    }
    return this;
  }
  throwException(enabled = true) {
    this.options.throwException = enabled;
    return this;
  }
  cleanOutput(enabled = true) {
    this.options.cleanOutput = enabled;
    return this;
  }
  typeSchema(cfg) {
    this.options.typeSchema ??= {};
    if (cfg.treeShake) {
      assert4(this.options.typeSchema.treeShake === void 0, "treeShake option is already set");
      this.options.typeSchema.treeShake = cfg.treeShake;
    }
    if (cfg.treeShakeDefaults) {
      assert4(this.options.typeSchema.treeShakeDefaults === void 0, "treeShakeDefaults option is already set");
      this.options.typeSchema.treeShakeDefaults = cfg.treeShakeDefaults;
    }
    if (cfg.promoteLogical) {
      assert4(this.options.typeSchema.promoteLogical === void 0, "promoteLogical option is already set");
      this.options.typeSchema.promoteLogical = cfg.promoteLogical;
    }
    if (cfg.resolveCollisions) {
      assert4(this.options.typeSchema.resolveCollisions === void 0, "resolveCollisions option is already set");
      this.options.typeSchema.resolveCollisions = cfg.resolveCollisions;
    }
    this.irReport({});
    return this;
  }
  irReport(userOpts) {
    const defaultWriterOpts = {
      logger: this.logger,
      outputDir: this.options.outputDir,
      inMemoryOnly: false
    };
    const opts = {
      ...defaultWriterOpts,
      rootReadmeFileName: "README.md",
      ...Object.fromEntries(Object.entries(userOpts ?? {}).filter(([_, v]) => v !== void 0))
    };
    const writer = new IrReportWriterWriter(opts);
    this.generators.push({ name: "ir-report", writer });
    this.logger.debug(`Configured ir-report generator (${JSON.stringify(opts, void 0, 2)})`);
    return this;
  }
  async generate() {
    const startTime = performance.now();
    const result = {
      success: false,
      outputDir: this.options.outputDir,
      filesGenerated: {},
      errors: [],
      warnings: [],
      duration: 0
    };
    this.logger.debug(`Starting generation with ${this.generators.length} generators`);
    try {
      if (this.options.cleanOutput) await cleanup(this.options, this.logger);
      let register;
      if (this.prebuiltRegister) {
        this.logger.info("Using prebuilt register");
        register = this.prebuiltRegister;
      } else {
        this.logger.info("Initialize Canonical Manager");
        if (this.managerInput.npmPackages.length > 0) {
          await this.manager.addPackages(...this.managerInput.npmPackages.sort());
        }
        for (const config of this.managerInput.localSDs) {
          await this.manager.addLocalPackage(config);
        }
        for (const tgzArchive of this.managerInput.localTgzPackages) {
          await this.manager.addTgzPackage(tgzArchive);
        }
        const ref2meta = await this.manager.init();
        const packageMetas = Object.values(ref2meta);
        register = await registerFromManager(this.manager, {
          logger: this.logger.fork("reg"),
          focusedPackages: packageMetas
        });
      }
      const tsLogger = this.logger.fork("ts");
      const { schemas: typeSchemas, collisions } = await generateTypeSchemas(
        register,
        this.options.typeSchema?.resolveCollisions,
        tsLogger
      );
      const irReport = {
        resolveCollisions: this.options.typeSchema?.resolveCollisions,
        collisions
      };
      const tsIndexOpts = { register, irReport, logger: tsLogger };
      let tsIndex = mkTypeSchemaIndex(typeSchemas, tsIndexOpts);
      if (this.options.typeSchema?.treeShake)
        tsIndex = treeShake(
          tsIndex,
          this.options.typeSchema.treeShake,
          this.options.typeSchema.treeShakeDefaults
        );
      if (this.options.typeSchema?.promoteLogical)
        tsIndex = promoteLogical(tsIndex, this.options.typeSchema.promoteLogical);
      tsLogger.printTagSummary();
      this.logger.debug(`Executing ${this.generators.length} generators`);
      await this.executeGenerators(result, tsIndex);
      this.logger.info("Generation completed successfully");
      result.success = result.errors.length === 0;
      const totalFiles = Object.values(result.filesGenerated).reduce((n, f) => n + Object.keys(f).length, 0);
      this.logger.debug(`Generation completed: ${totalFiles} files`);
    } catch (error) {
      this.logger.error(`Code generation failed: ${error instanceof Error ? error.message : String(error)}`);
      result.errors.push(error instanceof Error ? error.message : String(error));
      if (this.options.throwException) throw error;
    }
    return {
      ...result,
      success: result.errors.length === 0,
      duration: performance.now() - startTime
    };
  }
  /**
   * Clear all configuration and start fresh
   */
  reset() {
    this.generators = [];
    return this;
  }
  /**
   * Get configured generators (for inspection)
   */
  getGenerators() {
    return this.generators.map((g) => g.name);
  }
  async executeGenerators(result, tsIndex) {
    for (const gen of this.generators) {
      this.logger.info(`Generating ${gen.name}...`);
      try {
        await gen.writer.generateAsync(tsIndex);
        const fileBuffer = gen.writer.writtenFiles();
        const files = result.filesGenerated[gen.name] ??= {};
        fileBuffer.forEach((buf) => {
          files[buf.relPath] = buf.content;
        });
        this.logger.info(`Generating ${gen.name} finished successfully`);
      } catch (error) {
        result.errors.push(
          `${gen.name} generator failed: ${error instanceof Error ? error.message : String(error)}`
        );
        if (this.options.throwException) throw error;
      }
    }
  }
};

export { APIBuilder, mkCodegenLogger, prettyReport, registerFromManager, registerFromPackageMetas };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map