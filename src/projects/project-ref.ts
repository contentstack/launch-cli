export const PROJECT_UID_PATTERN = /^[0-9a-f]{24}$/i;

export interface ProjectUidRef {
  readonly kind: 'uid';
  readonly uid: string;
}

export interface ProjectNameRef {
  readonly kind: 'name';
  readonly name: string;
}

export type ProjectRef = ProjectUidRef | ProjectNameRef;

export function parseProjectRef(input: string): ProjectRef {
  return PROJECT_UID_PATTERN.test(input) ? { kind: 'uid', uid: input } : { kind: 'name', name: input };
}

export function uidProjectRef(input: string): ProjectUidRef {
  return { kind: 'uid', uid: input };
}

export const ProjectRef = { parse: parseProjectRef, uid: uidProjectRef };
