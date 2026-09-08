import pytest

from filtro.filtros import (
    Condicao,
    ErroDeFiltro,
    analisar_condicao,
    como_data,
    como_numero,
)


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Cidade = São Paulo", ("Cidade", "igual", "São Paulo")),
        ("Cidade=São Paulo", ("Cidade", "igual", "São Paulo")),
        ("Valor > 1000", ("Valor", "maior", "1000")),
        ("Valor>=1000", ("Valor", "maior_igual", "1000")),
        ("Valor <= 1000", ("Valor", "menor_igual", "1000")),
        ("Status != Pago", ("Status", "diferente", "Pago")),
        ("Status <> Pago", ("Status", "diferente", "Pago")),
        ("Cliente contem silva", ("Cliente", "contem", "silva")),
        ("Cliente contém Silva", ("Cliente", "contem", "Silva")),
        ("Cliente nao contem silva", ("Cliente", "nao_contem", "silva")),
        ("Cliente não_contém Silva", ("Cliente", "nao_contem", "Silva")),
        ("Produto comeca com Note", ("Produto", "comeca_com", "Note")),
        ("Produto termina_com book", ("Produto", "termina_com", "book")),
        ("Data entre 2024-01-01 e 2024-03-31", ("Data", "entre", "2024-01-01 e 2024-03-31")),
        ("Estado em SP;RJ", ("Estado", "em", "SP;RJ")),
        ("Observação vazio", ("Observação", "vazio")),
        ("Observação nao vazio", ("Observação", "nao_vazio")),
        ("Nome da Cidade = Recife", ("Nome da Cidade", "igual", "Recife")),
        ('Cliente = "Ana Souza"', ("Cliente", "igual", "Ana Souza")),
    ],
)
def test_analisar_condicao(texto, esperado):
    condicao = analisar_condicao(texto)
    valor = esperado[2] if len(esperado) > 2 else ""
    assert (condicao.coluna, condicao.operador, condicao.valor) == (esperado[0], esperado[1], valor)


def test_coluna_entre_aspas_com_palavra_de_operador():
    condicao = analisar_condicao('"Item em estoque" = sim')
    assert condicao.coluna == "Item em estoque"
    assert condicao.operador == "igual"
    assert condicao.valor == "sim"


def test_operador_mais_a_esquerda_vence():
    condicao = analisar_condicao("Descricao = contem algo")
    assert (condicao.coluna, condicao.operador, condicao.valor) == ("Descricao", "igual", "contem algo")


@pytest.mark.parametrize(
    "texto",
    ["", "   ", "Cidade São Paulo", "Cidade @ SP", "= SP", "Valor maior", "Status vazio agora"],
)
def test_condicoes_invalidas(texto):
    with pytest.raises(ErroDeFiltro):
        analisar_condicao(texto)


def test_operador_desconhecido():
    with pytest.raises(ErroDeFiltro):
        Condicao("Valor", "aproximadamente", "10")


@pytest.mark.parametrize(
    "bruto, esperado",
    [
        (10, 10.0),
        (10.5, 10.5),
        ("10", 10.0),
        ("10,5", 10.5),
        ("1.234,56", 1234.56),
        ("1,234.56", 1234.56),
        ("1.234.567", 1234567.0),
        ("R$ 1.500,00", 1500.0),
        ("(200)", -200.0),
        ("abc", None),
        ("", None),
        (None, None),
        (True, None),
    ],
)
def test_como_numero(bruto, esperado):
    assert como_numero(bruto) == esperado


@pytest.mark.parametrize("bruto", ["2024-03-15", "15/03/2024", "15-03-2024", "2024/03/15"])
def test_como_data(bruto):
    data = como_data(bruto)
    assert (data.year, data.month, data.day) == (2024, 3, 15)


def test_como_data_invalida():
    assert como_data("qualquer coisa") is None


@pytest.mark.parametrize(
    "operador, valor, celula, esperado",
    [
        ("igual", "sp", "SP", True),
        ("igual", "sao paulo", "São Paulo", True),
        ("igual", "10", 10, True),
        ("igual", "10,0", "10", True),
        ("diferente", "SP", "RJ", True),
        ("maior", "1000", 1500, True),
        ("maior", "1000", 500, False),
        ("maior_igual", "1000", 1000, True),
        ("menor", "2024-02-01", "2024-01-15", True),
        ("menor_igual", "10", 10, True),
        ("contem", "note", "Notebook", True),
        ("contem", "book", "Notebook", True),
        ("nao_contem", "mouse", "Notebook", True),
        ("comeca_com", "note", "Notebook", True),
        ("comeca_com", "book", "Notebook", False),
        ("termina_com", "book", "Notebook", True),
        ("entre", "10 e 20", 15, True),
        ("entre", "10..20", 25, False),
        ("entre", "2024-01-01 e 2024-03-31", "2024-02-10", True),
        ("em", "SP;RJ;MG", "rj", True),
        ("em", "SP;RJ;MG", "BA", False),
        ("vazio", "", None, True),
        ("vazio", "", "  ", True),
        ("vazio", "", "x", False),
        ("nao_vazio", "", "x", True),
    ],
)
def test_avaliacao_dos_operadores(operador, valor, celula, esperado):
    assert Condicao("c", operador, valor).avalia(celula) is esperado


def test_comparacao_sensivel_a_caixa_e_acento():
    condicao = Condicao("c", "igual", "sao paulo")
    assert condicao.avalia("São Paulo") is True
    assert condicao.avalia("São Paulo", sensivel=True) is False


def test_celula_vazia_nao_passa_em_comparacoes():
    assert Condicao("c", "igual", "SP").avalia(None) is False
    assert Condicao("c", "contem", "SP").avalia("") is False
    assert Condicao("c", "diferente", "SP").avalia(None) is True
    assert Condicao("c", "nao_contem", "SP").avalia(None) is True


def test_entre_sem_dois_valores():
    with pytest.raises(ErroDeFiltro):
        Condicao("c", "entre", "10").avalia(15)
