import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * OutboxStore backed by AsyncStorage (K2.31). Survives app restarts —
 * this is the production store. Tests use InMemoryOutboxStore.
 */
export const asyncStorageOutboxStore = {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
};
