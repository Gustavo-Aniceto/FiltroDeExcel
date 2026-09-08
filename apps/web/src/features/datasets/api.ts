import type { Dataset, DatasetProfile, Paginated } from '@excelflow/contracts';
import { api, uploadFile } from '@/lib/api-client';

/** Chaves de cache do React Query, centralizadas para invalidacao consistente. */
export const datasetKeys = {
  all: ['datasets'] as const,
  list: (page: number) => ['datasets', 'list', page] as const,
  detail: (id: string) => ['datasets', 'detail', id] as const,
};

export function fetchDatasets(page = 1, pageSize = 20): Promise<Paginated<Dataset>> {
  return api.get<Paginated<Dataset>>(`/datasets?page=${page}&pageSize=${pageSize}`);
}

export function fetchDatasetProfile(id: string): Promise<DatasetProfile> {
  return api.get<DatasetProfile>(`/datasets/${id}`);
}

export function deleteDataset(id: string): Promise<void> {
  return api.delete<void>(`/datasets/${id}`);
}

export function uploadDataset(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<DatasetProfile> {
  return uploadFile<DatasetProfile>('/datasets', file, { onProgress });
}
