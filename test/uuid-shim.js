let counter = 0;

function nextId() {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
}

const NIL = '00000000-0000-0000-0000-000000000000';

function v1() {
  return nextId();
}

function v4() {
  return nextId();
}

function v5() {
  return nextId();
}

function v6() {
  return nextId();
}

function v7() {
  return nextId();
}

function validate(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function version(id) {
  return Number(id.charAt(14));
}

function parse(id) {
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

function stringify(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

module.exports = { NIL, v1, v4, v5, v6, v7, validate, version, parse, stringify };
