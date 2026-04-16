import { HttpError } from '@/server/http';

export function enforceLock(record: { locked: boolean }, force?: boolean, label = 'Record') {
  if (record.locked && !force) {
    throw new HttpError(409, `${label} is locked; pass { force: true } to override.`);
  }
}
