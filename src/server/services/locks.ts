import { HttpError } from '@/server/http';

export function enforceLock(
  record: { locked: boolean },
  force?: boolean,
  label = 'Record',
) {
  if (record.locked && !force) {
    throw new HttpError(409, `${label} is locked; pass { force: true } to override.`);
  }
}

// Element lock enforcement — same semantics, separate label for clarity.
export function enforceElementLock(
  element: { locked: boolean; selectorId: string },
  force?: boolean,
) {
  if (element.locked && !force) {
    throw new HttpError(
      409,
      `Element ${element.selectorId} is locked; pass { force: true } to override.`,
    );
  }
}
