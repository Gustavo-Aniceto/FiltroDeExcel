import pytest

from filtro.filtros import Condicao, ErroDeFiltro, analisar_condicao
from filtro.motor import Ordenacao, filtrar, normalizar_modo, ordenar_linhas, resumir
from filtro.planilha import ErroDePlanilha, Planilha


@pytest.fixture
def vendas():
    return Planilha(
        ["Cliente", "Estado", "Valor", "Data", "Status"],
        [
            ["Ana Souza", "SP", 7500, "2024-01-15", "Pago"],
            ["Bruno Lima", "RJ", 2400, "2024-01-22", "Pendente"],
            ["Carla Dias", "MG", 1200, "2024-02-03", "Pago"],
            ["Diego Alves", "SP", 900, "2024-02-11", "Cancelado"],
            ["Elaine Costa", "PR", 3750, "2024-03-19", "Pago"],
        ],
    )


def nomes(planilha):
    return [linha[0] for linha in planilha.linhas]


def test_sem_condicoes_devolve_tudo(vendas):
    assert len(filtrar(vendas)) == 5


def test_modo_e_exige_todas(vendas):
    condicoes = [analisar_condicao("Estado = SP"), analisar_condicao("Valor > 1000")]
    assert nomes(filtrar(vendas, condicoes)) == ["Ana Souza"]


def test_modo_ou_exige_apenas_uma(vendas):
    condicoes = [analisar_condicao("Estado = MG"), analisar_condicao("Valor > 5000")]
    assert nomes(filtrar(vendas, condicoes, modo="ou")) == ["Ana Souza", "Carla Dias"]


def test_inverter_devolve_o_complemento(vendas):
    condicoes = [analisar_condicao("Estado = SP")]
    assert nomes(filtrar(vendas, condicoes, inverter=True)) == ["Bruno Lima", "Carla Dias", "Elaine Costa"]


def test_filtro_por_intervalo_de_datas(vendas):
    condicoes = [analisar_condicao("Data entre 2024-01-20 e 2024-02-28")]
    assert nomes(filtrar(vendas, condicoes)) == ["Bruno Lima", "Carla Dias", "Diego Alves"]


def test_filtro_por_lista(vendas):
    condicoes = [analisar_condicao("Estado em SP;PR")]
    assert nomes(filtrar(vendas, condicoes)) == ["Ana Souza", "Diego Alves", "Elaine Costa"]


def test_selecao_de_colunas_e_limite(vendas):
    resultado = filtrar(vendas, colunas=["Cliente", "Valor"], ordenar=[Ordenacao("Valor", True)], limite=2)
    assert resultado.colunas == ["Cliente", "Valor"]
    assert nomes(resultado) == ["Ana Souza", "Elaine Costa"]


def test_limite_negativo(vendas):
    with pytest.raises(ErroDeFiltro):
        filtrar(vendas, limite=-1)


def test_coluna_inexistente(vendas):
    with pytest.raises(ErroDePlanilha):
        filtrar(vendas, [Condicao("Cidade", "igual", "Recife")])


def test_modo_invalido(vendas):
    with pytest.raises(ErroDeFiltro):
        filtrar(vendas, modo="talvez")


@pytest.mark.parametrize("bruto, esperado", [("e", "e"), ("E", "e"), ("and", "e"), ("ou", "ou"), ("OR", "ou")])
def test_normalizar_modo(bruto, esperado):
    assert normalizar_modo(bruto) == esperado


def test_ordenar_crescente_e_decrescente(vendas):
    assert nomes(ordenar_linhas(vendas, [Ordenacao("Valor")]))[0] == "Diego Alves"
    assert nomes(ordenar_linhas(vendas, [Ordenacao("Valor", True)]))[0] == "Ana Souza"


def test_ordenar_por_varios_criterios(vendas):
    ordenada = ordenar_linhas(vendas, [Ordenacao("Estado"), Ordenacao("Valor", True)])
    assert nomes(ordenada) == ["Carla Dias", "Elaine Costa", "Bruno Lima", "Ana Souza", "Diego Alves"]


def test_ordenar_coloca_vazios_no_fim():
    planilha = Planilha(["a"], [[None], [2], [""], [1]])
    assert [linha[0] for linha in ordenar_linhas(planilha, [Ordenacao("a")]).linhas] == [1, 2, None, ""]


@pytest.mark.parametrize(
    "texto, coluna, decrescente",
    [
        ("Valor", "Valor", False),
        ("Valor:desc", "Valor", True),
        ("Valor:DESC", "Valor", True),
        ("Valor:decrescente", "Valor", True),
        ("Valor:asc", "Valor", False),
        ("Hora:Minuto", "Hora:Minuto", False),
    ],
)
def test_analisar_ordenacao(texto, coluna, decrescente):
    criterio = Ordenacao.analisar(texto)
    assert (criterio.coluna, criterio.decrescente) == (coluna, decrescente)


def test_ordenacao_vazia():
    with pytest.raises(ErroDeFiltro):
        Ordenacao.analisar("  ")


def test_resumir(vendas):
    resultado = filtrar(vendas, [analisar_condicao("Estado = SP")])
    assert resumir(resultado, [analisar_condicao("Estado = SP")], len(vendas)) == (
        "2 de 5 linhas (Estado igual SP)"
    )


def test_planilha_original_nao_e_alterada(vendas):
    filtrar(vendas, [analisar_condicao("Estado = SP")], ordenar=[Ordenacao("Valor")], limite=1)
    assert len(vendas) == 5
    assert nomes(vendas)[0] == "Ana Souza"
