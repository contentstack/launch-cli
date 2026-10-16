export const UID_PATTERN = /^[0-9a-f]{24}$/i;

export interface UidRef {
  readonly kind: 'uid';
  readonly uid: string;
}

export interface NameRef {
  readonly kind: 'name';
  readonly name: string;
}

export type ResourceRef = UidRef | NameRef;

function parse(input: string): ResourceRef {
  return UID_PATTERN.test(input) ? { kind: 'uid', uid: input } : { kind: 'name', name: input };
}

function uid(input: string): UidRef {
  return { kind: 'uid', uid: input };
}

export const ResourceRef = { parse, uid };
