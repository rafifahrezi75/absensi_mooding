import axios from 'axios';

const DB_NAME = 'FaceKioskOfflineDB';
const DB_VERSION = 1;
const STORE_EVENTS = 'offline_events';
const STORE_EMPLOYEES = 'cached_employees';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        db.createObjectStore(STORE_EVENTS, { keyPath: 'idempotency_key' });
      }
      if (!db.objectStoreNames.contains(STORE_EMPLOYEES)) {
        db.createObjectStore(STORE_EMPLOYEES, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveOfflineEvent(eventData: any): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    store.put(eventData);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineEvents(): Promise<any[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const store = tx.objectStore(STORE_EVENTS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removeOfflineEvent(idempotencyKey: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    store.delete(idempotencyKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineQueueCount(): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const store = tx.objectStore(STORE_EVENTS);
    const request = store.count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheEmployees(employees: any[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EMPLOYEES, 'readwrite');
    const store = tx.objectStore(STORE_EMPLOYEES);
    store.clear();
    for (const emp of employees) {
      store.put(emp);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedEmployees(): Promise<any[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EMPLOYEES, 'readonly');
    const store = tx.objectStore(STORE_EMPLOYEES);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const events = await getOfflineEvents();
  if (events.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  const batch = events.slice(0, 15);
  for (const ev of batch) {
    try {
      if (ev.auth_method === 'fallback_pin') {
        await axios.post('/api/kiosk/fallback-tap', ev);
      } else {
        await axios.post('/api/kiosk/attendance-tap', ev);
      }
      await removeOfflineEvent(ev.idempotency_key);
      synced++;
    } catch (err: any) {
      if (err.response?.status === 409 || err.response?.data?.status === 'duplicate_ignored') {
        await removeOfflineEvent(ev.idempotency_key);
        synced++;
      } else {
        failed++;
      }
    }
  }

  return { synced, failed };
}
