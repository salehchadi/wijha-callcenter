import { ClientType, fromDbType, toDbType } from './client-type.enum';

describe('ClientType mapping', () => {
  it('should map UNKNOWN to NULL for the database', () => {
    expect(toDbType(ClientType.UNKNOWN)).toBeNull();
    expect(toDbType(undefined)).toBeNull();
  });

  it('should pass OWNER, LEAD, BOTH through', () => {
    expect(toDbType(ClientType.OWNER)).toBe('OWNER');
    expect(toDbType(ClientType.LEAD)).toBe('LEAD');
    expect(toDbType(ClientType.BOTH)).toBe('BOTH');
  });

  it('should map NULL to UNKNOWN from the database', () => {
    expect(fromDbType(null)).toBe(ClientType.UNKNOWN);
    expect(fromDbType(undefined)).toBe(ClientType.UNKNOWN);
    expect(fromDbType('OWNER')).toBe(ClientType.OWNER);
  });
});
