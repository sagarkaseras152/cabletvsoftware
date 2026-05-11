export function forTenant(records, tenantId, role) {
  if (role === "platform_owner") {
    return records;
  }

  return records.filter((record) => record.tenantId === tenantId);
}
