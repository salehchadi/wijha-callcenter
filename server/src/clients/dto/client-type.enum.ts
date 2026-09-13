export enum ClientType {
  OWNER = 'OWNER',
  LEAD = 'LEAD',
  BOTH = 'BOTH',
  UNKNOWN = 'UNKNOWN',
}

export function toDbType(type: ClientType | string | undefined | null): string | null {
  if (type === undefined || type === null) return null;
  if (type === ClientType.UNKNOWN) return null;
  return type;
}

export function fromDbType(type: string | null | undefined): ClientType {
  if (type === null || type === undefined) return ClientType.UNKNOWN;
  if (type === ClientType.OWNER || type === ClientType.LEAD || type === ClientType.BOTH) return type;
  return ClientType.UNKNOWN;
}
