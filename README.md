# FiltroDeExcel

Sistema simples de filtragem de planilhas. Lê um arquivo `.xlsx`, `.xlsm`, `.csv`
ou `.tsv`, aplica condições escritas em português (`Cidade = São Paulo`,
`Valor > 1000`, `Status contem pendente`) e mostra o resultado no terminal ou
grava em um novo arquivo.

- Sem depender de Excel instalado — a única dependência é o `openpyxl`.
- Comparações ignoram maiúsculas e acentos por padrão (`sao paulo` acha `São Paulo`).
- Entende números no formato brasileiro (`1.234,56`, `R$ 1.500,00`) e datas
  em `aaaa-mm-dd` ou `dd/mm/aaaa`.
- Pode ser usado pela linha de comando ou como biblioteca Python.

## Instalação

```bash
git clone https://github.com/Gustavo-Aniceto/FiltroDeExcel.git
cd FiltroDeExcel
pip install -r requirements.txt
```

Para instalar o comando `filtro-planilha` no sistema:

```bash
pip install .
```

Sem instalar nada, também dá para rodar direto da pasta do projeto com
`python -m filtro`.

## Uso rápido

```bash
# ver as colunas do arquivo
python -m filtro exemplos/vendas.xlsx --listar-colunas

# filtrar e ver o resultado no terminal
python -m filtro exemplos/vendas.xlsx --onde "Estado = SP"

# duas condições (as duas precisam passar) e gravar o resultado
python -m filtro exemplos/vendas.xlsx \
    --onde "Estado = SP" \
    --onde "Valor > 3000" \
    --saida resultado.xlsx
```

Saída típica:

```
  ID  Cliente        Cidade     Estado  Produto   Quantidade  Valor  Data        Status
----  -------------  ---------  ------  --------  ----------  -----  ----------  --------
1001  Ana Souza      São Paulo  SP      Notebook           2   7500  2024-01-15  Pago
1007  Gabriela Melo  São Paulo  SP      Monitor            5   4000  2024-03-08  Pago
1015  Olivia Gomes   São Paulo  SP      Cadeira            8   7200  2024-05-16  Pendente
3 de 15 linhas (Estado igual SP; Valor maior 3000)
```

## Como escrever as condições

Cada `--onde` recebe um texto no formato **`coluna operador valor`**:

```bash
--onde "Cidade = São Paulo"
--onde "Valor >= 1000"
--onde "Cliente contem silva"
--onde "Data entre 2024-01-01 e 2024-03-31"
--onde "Estado em SP;RJ;MG"
--onde "Observação vazio"
```

| Operador | Como escrever | O que faz |
| --- | --- | --- |
| igual | `=`, `==`, `igual` | igual ao valor (número, data ou texto) |
| diferente | `!=`, `<>`, `diferente` | diferente do valor |
| maior | `>`, `maior` | maior que |
| maior ou igual | `>=`, `maior igual` | maior ou igual a |
| menor | `<`, `menor` | menor que |
| menor ou igual | `<=`, `menor igual` | menor ou igual a |
| contém | `contem`, `contém` | o texto aparece na célula |
| não contém | `nao contem`, `não contém` | o texto não aparece na célula |
| começa com | `comeca com`, `começa com` | a célula começa com o texto |
| termina com | `termina com` | a célula termina com o texto |
| entre | `entre 10 e 20`, `entre 10..20` | dentro do intervalo (inclusive) |
| em | `em SP;RJ;MG` | igual a um dos valores da lista |
| vazio | `vazio` | célula em branco |
| não vazio | `nao vazio`, `não vazio` | célula preenchida |

Detalhes úteis:

- O nome da coluna também ignora acentos e maiúsculas: `observacao` acha `Observação`.
- Se o nome da coluna contiver uma palavra de operador, coloque-o entre aspas:
  `--onde '"Item em estoque" = sim'`.
- Células vazias não passam em comparações (só em `vazio`, `diferente` e `nao contem`).
- Use `--sensivel` quando quiser diferenciar maiúsculas e acentos.

## Opções da linha de comando

| Opção | Descrição |
| --- | --- |
| `-w`, `--onde CONDICAO` | condição de filtro; pode repetir |
| `-m`, `--modo e\|ou` | `e` exige todas as condições (padrão), `ou` exige pelo menos uma |
| `--inverter` | devolve as linhas que **não** passaram |
| `-c`, `--colunas LISTA` | colunas da saída, separadas por vírgula (define também a ordem) |
| `-s`, `--ordenar COLUNA[:asc\|desc]` | ordena o resultado; pode repetir |
| `-n`, `--limite N` | mantém apenas as N primeiras linhas |
| `-o`, `--saida ARQUIVO` | grava o resultado (`.xlsx`, `.xlsm`, `.csv`, `.tsv`) |
| `--aba NOME\|N` | escolhe a aba do Excel (padrão: a primeira) |
| `--linha-cabecalho N` | linha com os títulos das colunas (padrão: 1) |
| `--delimitador C` | separador ao gravar arquivos de texto |
| `--sensivel` | diferencia maiúsculas e acentos |
| `--listar-colunas` | apenas lista as colunas do arquivo |
| `--contar` | apenas imprime quantas linhas passaram |
| `--max-linhas N` | linhas da prévia no terminal (padrão: 20) |

Sem `--saida`, o comando imprime uma prévia no terminal. O código de saída é
`0` em caso de sucesso e `2` quando há erro (arquivo inexistente, coluna
desconhecida, condição malformada).

## Mais exemplos

```bash
# clientes de SP, RJ ou MG com pagamento pendente, do maior valor para o menor
python -m filtro exemplos/vendas.csv \
    --onde "Estado em SP;RJ;MG" \
    --onde "Status = Pendente" \
    --ordenar "Valor:desc" \
    --colunas Cliente,Estado,Valor

# vendas do primeiro trimestre, gravando em CSV
python -m filtro exemplos/vendas.xlsx \
    --onde "Data entre 2024-01-01 e 2024-03-31" \
    --saida primeiro_trimestre.csv

# tudo o que NÃO foi pago, contando as linhas
python -m filtro exemplos/vendas.xlsx --onde "Status = Pago" --inverter --contar

# planilha cujo cabeçalho está na linha 3, aba "Relatório"
python -m filtro relatorio.xlsx --aba "Relatório" --linha-cabecalho 3 --listar-colunas
```

## Usando como biblioteca

```python
from filtro import analisar_condicao, escrever, filtrar, ler
from filtro.motor import Ordenacao

planilha = ler("exemplos/vendas.xlsx")

resultado = filtrar(
    planilha,
    [analisar_condicao("Estado = SP"), analisar_condicao("Valor > 3000")],
    modo="e",
    colunas=["Cliente", "Valor"],
    ordenar=[Ordenacao("Valor", decrescente=True)],
    limite=10,
)

print(len(resultado), "linhas")
escrever(resultado, "resultado.xlsx")
```

As condições também podem ser montadas direto, sem texto:

```python
from filtro import Condicao

Condicao("Valor", "maior", "3000")
```

## Estrutura do projeto

```
filtro/
  planilha.py   leitura e escrita de .xlsx/.xlsm/.csv/.tsv
  filtros.py    operadores, conversões (número/data) e leitura das condições
  motor.py      aplica as condições, ordena e recorta
  cli.py        interface de linha de comando
exemplos/
  vendas.csv                  dados de exemplo
  gerar_planilha_exemplo.py   gera exemplos/vendas.xlsx a partir do CSV
tests/          testes automatizados (pytest)
```

## Testes

```bash
pip install pytest
python -m pytest
```

## Limitações conhecidas

- Fórmulas do Excel são lidas pelo último valor calculado e salvo no arquivo.
- A gravação em `.xlsx` produz uma planilha nova (cabeçalho em negrito, filtro
  automático e painel congelado); formatação da planilha de origem não é copiada.
- Um número escrito com um único ponto (`1.500`) é lido como `1.5`; para o
  formato brasileiro use `1.500,00` ou `1500`.
