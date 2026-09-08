import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { DatasetList } from '@/features/datasets/DatasetList';
import { datasetKeys, deleteDataset, fetchDatasets, uploadDataset } from '@/features/datasets/api';
import { UploadDropzone } from '@/features/upload/UploadDropzone';

export default function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: datasetKeys.list(1),
    queryFn: () => fetchDatasets(1, 20),
  });

  const removeMutation = useMutation({
    mutationFn: deleteDataset,
    onMutate: (id: string) => setDeletingId(id),
    onSettled: () => {
      setDeletingId(null);
      void queryClient.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });

  async function handleUpload(file: File, onProgress: (percent: number) => void) {
    const profile = await uploadDataset(file, onProgress);
    // Semeia o cache com o perfil que acabou de chegar: a navegacao para o
    // dashboard fica instantanea, sem um segundo GET do que ja temos em maos.
    queryClient.setQueryData(datasetKeys.detail(profile.dataset.id), profile);
    void queryClient.invalidateQueries({ queryKey: datasetKeys.all });
    navigate(`/planilhas/${profile.dataset.id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-content">Planilhas</h1>
        <p className="mt-1 text-sm text-content-muted">
          Envie uma planilha para ver a analise automatica da estrutura e dos valores.
        </p>
      </div>

      <UploadDropzone onUpload={handleUpload} />

      <Card>
        <CardHeader
          title="Enviadas recentemente"
          description={
            data ? `${data.total} planilha(s) no total` : 'Carregando planilhas enviadas'
          }
        />
        <CardBody className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner label="Carregando planilhas" />
            </div>
          ) : (
            <DatasetList
              datasets={data?.items ?? []}
              deletingId={deletingId}
              onDelete={(id) => removeMutation.mutate(id)}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
