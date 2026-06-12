export interface Transaction {
  id: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TransactionManager {
  begin(): Promise<Transaction>;
}
