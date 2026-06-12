export interface ProjectProfile {
  id: string;
  name: string;
  repoIds: string[];
  domains: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}
