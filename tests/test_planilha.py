from datetime import datetime

import pytest
from openpyxl import Workbook

from filtro.planilha import ErroDePlanilha, Planilha, escrever, ler

CSV_EXEMPLO = "Nome;Cidade;Valor\nAna;São Paulo;100\nBruno;Recife;250\n"


@pytest.fixture
def csv_temporario(tmp_path):
    caminho = tmp_path / "dados.csv"
    caminho.write_text(CSV_EXEMPLO, encoding="utf-8")
    return caminho


@pytest.fixture
def xlsx_temporario(tmp_path):
    arquivo = Workbook()
    aba = arquivo.active
    aba.title = "Vendas"
    aba.append(["Nome", "Cidade", "Valor", "Data"])
    aba.append(["Ana", "São Paulo", 100, datetime(2024, 1, 15)])
    aba.append(["Bruno", "Recife", 250, datetime(2024, 2, 20)])
    outra = arquivo.create_sheet("Resumo")
    outra.append(["Total"])
    outra.append([350])
    caminho = tmp_path / "dados.xlsx"
    arquivo.save(caminho)
    return caminho


def test_ler_csv_detecta_delimitador(csv_temporario):
    planilha = ler(csv_temporario)
    assert planilha.colunas == ["Nome", "Cidade", "Valor"]
    assert planilha.delimitador == ";"
    assert len(planilha) == 2
    assert planilha.linhas[0] == ["Ana", "São Paulo", "100"]


def test_ler_csv_com_virgula(tmp_path):
    caminho = tmp_path / "dados.csv"
    caminho.write_text("a,b\n1,2\n", encoding="utf-8")
    assert ler(caminho).delimitador == ","


def test_ler_ignora_linhas_totalmente_vazias(tmp_path):
    caminho = tmp_path / "dados.csv"
    caminho.write_text("a;b\n1;2\n;\n3;4\n", encoding="utf-8")
    assert len(ler(caminho)) == 2


def test_ler_xlsx(xlsx_temporario):
    planilha = ler(xlsx_temporario)
    assert planilha.nome == "Vendas"
    assert planilha.colunas == ["Nome", "Cidade", "Valor", "Data"]
    assert planilha.linhas[0][2] == 100
    assert planilha.linhas[1][3] == datetime(2024, 2, 20)


def test_ler_xlsx_escolhendo_aba(xlsx_temporario):
    assert ler(xlsx_temporario, aba="resumo").colunas == ["Total"]
    assert ler(xlsx_temporario, aba=2).colunas == ["Total"]


def test_aba_inexistente(xlsx_temporario):
    with pytest.raises(ErroDePlanilha):
        ler(xlsx_temporario, aba="Nao Existe")
    with pytest.raises(ErroDePlanilha):
        ler(xlsx_temporario, aba=9)


def test_linha_de_cabecalho_diferente(tmp_path):
    caminho = tmp_path / "dados.csv"
    caminho.write_text("Relatório de vendas;;\nNome;Cidade;Valor\nAna;Recife;10\n", encoding="utf-8")
    planilha = ler(caminho, linha_cabecalho=2)
    assert planilha.colunas == ["Nome", "Cidade", "Valor"]
    assert len(planilha) == 1


def test_arquivo_inexistente(tmp_path):
    with pytest.raises(ErroDePlanilha):
        ler(tmp_path / "nao_existe.csv")


def test_formato_nao_suportado(tmp_path):
    caminho = tmp_path / "dados.json"
    caminho.write_text("{}", encoding="utf-8")
    with pytest.raises(ErroDePlanilha):
        ler(caminho)


def test_cabecalho_com_colunas_sem_nome_e_repetidas(tmp_path):
    caminho = tmp_path / "dados.csv"
    caminho.write_text("Nome;;Nome\n1;2;3\n", encoding="utf-8")
    assert ler(caminho).colunas == ["Nome", "Coluna 2", "Nome (2)"]


def test_indice_ignora_acentos_e_caixa():
    planilha = Planilha(["Observação", "Valor"], [])
    assert planilha.indice("observacao") == 0
    assert planilha.indice("VALOR") == 1
    with pytest.raises(ErroDePlanilha):
        planilha.indice("Cidade")


def test_selecionar_colunas():
    planilha = Planilha(["a", "b", "c"], [[1, 2, 3], [4, 5, 6]])
    recortada = planilha.selecionar(["c", "a"])
    assert recortada.colunas == ["c", "a"]
    assert recortada.linhas == [[3, 1], [6, 4]]


def test_escrever_e_reler_csv(tmp_path):
    planilha = Planilha(["Nome", "Valor"], [["Ana", 10.0], ["Bruno", 20.5]], delimitador=";")
    destino = escrever(planilha, tmp_path / "saida.csv")
    assert destino.read_text(encoding="utf-8-sig").splitlines()[0] == "Nome;Valor"
    relida = ler(destino)
    assert relida.linhas == [["Ana", "10"], ["Bruno", "20.5"]]


def test_escrever_e_reler_xlsx(tmp_path):
    planilha = Planilha(["Nome", "Data"], [["Ana", datetime(2024, 5, 1)]], nome="Filtrado")
    destino = escrever(planilha, tmp_path / "saida.xlsx")
    relida = ler(destino)
    assert relida.nome == "Filtrado"
    assert relida.linhas == [["Ana", datetime(2024, 5, 1)]]


def test_escrever_cria_a_pasta(tmp_path):
    destino = escrever(Planilha(["a"], [[1]]), tmp_path / "nova" / "saida.csv")
    assert destino.exists()


def test_escrever_formato_nao_suportado(tmp_path):
    with pytest.raises(ErroDePlanilha):
        escrever(Planilha(["a"], [[1]]), tmp_path / "saida.pdf")
