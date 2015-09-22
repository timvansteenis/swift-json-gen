//
// Several functions for generating Swift code based on the parsed AST.
//

var ast = require('./SwiftAst')

function makeFile(file: any[], globalAttrs: GlobalAttrs, filename: string): string[] {

  function decoderExists(typeName: string) : boolean {
    return globalAttrs.decoders.contains(typeName);
  }

  function encoderExists(typeName: string) : boolean {
    return globalAttrs.encoders.contains(typeName);
  }

  var structs = ast.structs(file, globalAttrs.typeAliases)
    .filter(s => !decoderExists(s.baseName) || !encoderExists(s.baseName));

  var enums = ast.enums(file, globalAttrs.typeAliases)
    .filter(e => !decoderExists(e.baseName) || !encoderExists(e.baseName));

  var lines = [];

  lines.push('//');
  lines.push('//  ' + filename);
  lines.push('//');
  lines.push('//  Auto generated by swift-json-gen on ' + new Date().toUTCString());
  lines.push('//  See for details: https://github.com/tomlokhorst/swift-json-gen')
  lines.push('//');
  lines.push('');
  lines.push('import Foundation');
  lines.push('');

  enums.forEach(function (s) {

    var createDecoder = !decoderExists(s.baseName);
    var createEncoder = !encoderExists(s.baseName);

    lines.push('extension ' + s.baseName + ' {')

    if (createDecoder) {
      lines = lines.concat(makeEnumDecoder(s));
    }

    if (createDecoder && createEncoder) {
      lines.push('');
    }

    if (createEncoder) {
      lines = lines.concat(makeEnumEncoder(s));
    }

    lines.push('}');
    lines.push('');
  });

  structs.forEach(function (s) {

    var createDecoder = !decoderExists(s.baseName);
    var createEncoder = !encoderExists(s.baseName);

    lines.push('extension ' + s.baseName + ' {')

    if (createDecoder) {
      lines = lines.concat(makeStructDecoder(s));
    }

    if (createDecoder && createEncoder) {
      lines.push('');
    }

    if (createEncoder) {
      lines = lines.concat(makeStructEncoder(s, enums));
    }

    lines.push('}');
    lines.push('');
  });

  return lines;
}

exports.makeFile = makeFile;

function makeEnumDecoder(en: Enum) : string {
  var lines = [];

  lines.push('  static func decodeJson(json: AnyObject) -> ' + en.baseName + '? {');
  lines.push('    if let value = json as? ' + en.rawTypeName + ' {');
  lines.push('      return ' + en.baseName + '(rawValue: value)');
  lines.push('    }');
  lines.push('    return nil');
  lines.push('  }');

  return lines.join('\n');
}

function makeEnumEncoder(en: Enum) : string {
  var lines = [];

  lines.push('  func encodeJson() -> ' + en.rawTypeName + ' {');
  lines.push('    return rawValue');
  lines.push('  }');

  return lines.join('\n');
}

function makeStructDecoder(struct: Struct) : string {
  var lines = [];

  lines.push('  static func decodeJson' + decodeArguments(struct) + ' -> ' + struct.baseName + '? {');
  lines.push('    guard let dict = json as? [String : AnyObject] else {');
  lines.push('      assertionFailure("json not a dictionary")');
  lines.push('      return nil');
  lines.push('    }');
  lines.push('');

  struct.varDecls.forEach(function (d) {
    var subs = makeFieldDecode(d, struct.typeArguments).map(indent(4));
    lines = lines.concat(subs);
  });

  lines = lines.concat(indent(4)(makeReturn(struct)));

  lines.push('  }');

  return lines.join('\n');
}

function makeStructEncoder(struct: Struct, enums: Enum[]) : string {
  var lines = [];
  lines.push('  func encodeJson' + encodeArguments(struct) + ' -> [String: AnyObject] {');
  lines.push('    var dict: [String: AnyObject] = [:]');
  lines.push('');

  struct.varDecls.forEach(function (d) {
    var subs = makeFieldEncode(d, struct.typeArguments, enums).map(indent(4));
    lines = lines.concat(subs);
  });

  lines.push('');
  lines.push('    return dict');
  lines.push('  }');

  return lines.join('\n');
}

function decodeArguments(struct: Struct) : string {
  var parts = struct.typeArguments
    .map(t => 'decode' + t + ': AnyObject -> ' + t + '?')

  parts.push('json: AnyObject');

  for (var i = 1; i < parts.length; i++) {
    parts[i] = '_ ' + parts[i];
  }

  return '(' + parts.join(', ') + ')';
}

function encodeArguments(struct: Struct) : string {
  var parts = struct.typeArguments
    .map(t => 'encode' + t + ': ' + t + ' -> AnyObject')

  for (var i = 1; i < parts.length; i++) {
    parts[i] = '_ ' + parts[i];
  }

  return '(' + parts.join(', ') + ')';
}

function indent(nr) {
  return function (s) {
    return s == '' ? s :  Array(nr + 1).join(' ') + s;
  };
}

function isKnownType(type: Type) : boolean {
  var types = [ 'AnyObject', 'AnyJson' ];
  return types.contains(type.alias) || types.contains(type.baseName);
}

function isCastType(type: Type) : boolean {
  var types = [ 'JsonObject', 'JsonArray' ];
  return types.contains(type.alias) || types.contains(type.baseName);
}

function encodeFunction(name: string, type: Type, genericEncoders: string[]) : string {

  if (isKnownType(type))
    return name;

  if (genericEncoders.contains(type.baseName))
    return 'encode' + type.baseName + '(' + name + ')';

  var args = type.genericArguments
    .map(t => '{ ' + encodeFunction('$0', t, genericEncoders) + ' }')
    .join(', ');

  return name + '.encodeJson(' + args + ')';
}

function makeFieldEncode(field: VarDecl, structTypeArguments: string[], enums: Enum[]) {
  var lines = [];

  var name = field.name;
  var type = field.type;

  var prefix = ''

    if (type.baseName == 'Dictionary' && type.genericArguments.length == 2) {
      var keyType = type.genericArguments[0].baseName;
      var enum_ = enums.filter(e => e.baseName == keyType)[0];
      if (keyType != 'String' && enum_.rawTypeName != 'String') {
        lines.push('/* WARNING: Json only supports Strings as keys in dictionaries */');
      }
    }
  lines.push('dict["' + name + '"] = ' + encodeFunction(name, type, structTypeArguments));

  return lines;
}

function decodeFunction(arg: string, type: Type, genericDecoders: string[]) : string {
  var args = type.genericArguments
    .map(a => decodeFunctionArgument(a, genericDecoders))
    .concat([ arg ])
    .join(', ');

  var typeName = type.alias || type.baseName;

  if (isKnownType(type))
    return '{ $0 as ' + typeName + ' }';

  if (isCastType(type))
    return '{ $0 as? ' + typeName + ' }';

  if (genericDecoders.contains(typeName))
    return 'decode' + typeName + '(' + args + ')'

  return typeName + '.decodeJson(' + args + ')';
}

function decodeFunctionArgument(type: Type, genericDecoders: string[]) : string {

  var typeName = type.alias || type.baseName;

  if (isKnownType(type))
    return '{ $0 as ' + typeName + ' }';

  if (isCastType(type))
    return '{ $0 as? ' + typeName + ' }';

  return '{ ' + decodeFunction('$0', type, genericDecoders) + ' }'
}

function typeToString(type: Type) : string {
  if (type.genericArguments.length == 0)
    return type.baseName;

  if (type.baseName == 'Optional')
    return typeToString(type.genericArguments[0]) + '?';

  if (type.baseName == 'Array')
    return '[' + typeToString(type.genericArguments[0]) + ']';

  if (type.baseName == 'Dictionary')
    return '[' + typeToString(type.genericArguments[0]) + ' : ' + typeToString(type.genericArguments[1]) + ']';

  var args = type.genericArguments.map(typeToString).join(', ')
  return type.baseName + '<' + args + '>';
}

function makeFieldDecode(field: VarDecl, structTypeArguments: string[]) {
  var name = field.name;
  var type = field.type;
  var fieldName = name + '_field';
  var optionalName = name + '_optional';
  var typeString = typeToString(type);

  var lines = [];

  if (type.baseName == 'Optional') {
    lines.push('let ' + fieldName + ': AnyObject? = dict["' + name + '"]');
    lines.push('let ' + name + ': ' + typeString + ' = ' + fieldName + ' == nil || ' + fieldName + '! is NSNull ? nil : ' + decodeFunction(fieldName + '!', type, structTypeArguments))
  }
  else {
    lines.push('guard let ' + fieldName + ': AnyObject = dict["' + name + '"] else {');
    lines.push('  assertionFailure("field \'' + name + '\' is missing")');
    lines.push('  return nil');
    lines.push('}');

    if (isKnownType(type)) {
      lines.push('let ' + name + ': ' + typeString + ' = ' + fieldName);
    }
    else if (isCastType(type)) {
      lines.push('guard let ' + name + ': ' + typeString + ' = ' + fieldName + ' as? ' + typeString + ' else {')
      lines.push('  assertionFailure("field \'' + name + '\' is not a ' + typeString + '")');
      lines.push('  return nil');
      lines.push('}');
    }
    else {
      lines.push('guard let ' + name + ': ' + typeString + ' = ' + decodeFunction(fieldName, type, structTypeArguments) + ' else {')
      lines.push('  assertionFailure("field \'' + name + '\' is not a ' + typeString + '")');
      lines.push('  return nil');
      lines.push('}');
    }
  }

  lines.push('');

  return lines;
}

function makeReturn(struct: Struct) {
  var params = struct.varDecls.map(decl => decl.name + ': ' + decl.name);

  return 'return ' + struct.baseName + '(' + params.join(', ') + ')'
}

