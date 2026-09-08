"""Testes da inferencia de tipos.

O foco esta nas sujeiras de planilha REAL -- formato brasileiro, moeda como
texto, marcadores de vazio -- porque e onde um erro passa despercebido e
corrompe um relatorio financeiro silenciosamente.
"""

import polars as pl
import pytest

from app.ingestion.inference import coerce_dataframe, infer_strategy


def types_of(data: dict) -> dict[str, str]:
    _, types = coerce_dataframe(pl.DataFrame(data))
    return types


def values_of(data: dict, column: str) -> list:
    frame, _ = coerce_dataframe(pl.DataFrame(data))
    return frame.get_column(column).to_list()


class TestNumeros:
    def test_moeda_brasileira_como_texto(self) -> None:
        data = {"Valor da operacao": ["R$ 1.234,56", "R$ 42,00", "R$ 8.421,00"]}
        assert types_of(data)["Valor da operacao"] == "currency"
        assert values_of(data, "Valor da operacao") == [1234.56, 42.00, 8421.00]

    def test_ponto_e_separador_de_milhar_quando_ha_virgula_decimal(self) -> None:
        # A decisao e por COLUNA: se algum valor usa virgula decimal, o ponto
        # naquela coluna e separador de milhar. Misturar as duas leituras
        # produziria valores com escalas diferentes na mesma coluna.
        assert values_of({"v": ["1.234,56", "2.000", "999"]}, "v") == [1234.56, 2000.0, 999.0]

    def test_formato_internacional_sem_virgula_decimal(self) -> None:
        assert values_of({"v": ["1,234.56", "2000.50"]}, "v") == [1234.56, 2000.50]

    def test_parenteses_contabeis_viram_negativo(self) -> None:
        assert values_of({"Saldo": ["(1.234,56)", "500,00"]}, "Saldo") == [-1234.56, 500.00]

    def test_numero_sem_dica_no_cabecalho_e_number_e_nao_currency(self) -> None:
        assert types_of({"Quantidade": ["10", "20", "30"]})["Quantidade"] == "number"

    def test_cabecalho_monetario_marca_currency_mesmo_sem_simbolo(self) -> None:
        assert types_of({"Valor": ["10.50", "20.30"]})["Valor"] == "currency"

    def test_celula_suja_isolada_nao_rebaixa_a_coluna(self) -> None:
        # Uma unica sujeira no meio de 9 numeros nao deve transformar a coluna
        # em texto -- o usuario perderia a capacidade de somar.
        data = {"Valor": [f"{i},50" for i in range(9)] + ["N/D"]}
        assert types_of(data)["Valor"] == "currency"
        assert values_of(data, "Valor")[-1] is None

    def test_coluna_majoritariamente_texto_continua_texto(self) -> None:
        assert types_of({"Codigo": ["AB-1", "CD-2", "EF-3", "10"]})["Codigo"] == "text"


class TestDatas:
    def test_data_brasileira(self) -> None:
        data = {"Data": ["01/09/2026", "15/03/2026"]}
        assert types_of(data)["Data"] == "date"
        assert [d.strftime("%Y-%m-%d") for d in values_of(data, "Data")] == [
            "2026-09-01",
            "2026-03-15",
        ]

    def test_dia_antes_do_mes_no_caso_ambiguo(self) -> None:
        # 03/09/2026 e 3 de setembro para este publico. Inverter corromperia
        # silenciosamente todo filtro por periodo.
        assert values_of({"Data": ["03/09/2026"]}, "Data")[0].month == 9

    def test_formato_iso(self) -> None:
        assert values_of({"Data": ["2026-09-08"]}, "Data")[0].day == 8

    def test_data_com_hora(self) -> None:
        assert types_of({"Registro": ["08/09/2026 14:30:00"]})["Registro"] == "date"


class TestTextoEVazios:
    def test_marcadores_de_vazio_viram_nulo(self) -> None:
        # "-", "N/A" e "nao informado" significam ausencia. Se ficassem como
        # texto, o filtro "esta vazio" nao os encontraria.
        valores = values_of({"Obs": ["ok", "-", "N/A", "nao informado", ""]}, "Obs")
        assert valores == ["ok", None, None, None, None]

    def test_coluna_totalmente_vazia(self) -> None:
        data = {"Coluna": [None, "", "  "]}
        assert types_of(data)["Coluna"] == "empty"
        assert values_of(data, "Coluna") == [None, None, None]

    def test_espacos_ao_redor_sao_removidos(self) -> None:
        # "APROVADO " e "APROVADO" precisam ser o MESMO valor, senao o filtro
        # por igualdade devolve metade dos registros esperados.
        assert values_of({"S": [" APROVADO ", "APROVADO"]}, "S") == ["APROVADO", "APROVADO"]


class TestBooleanos:
    def test_sim_nao(self) -> None:
        data = {"Ativo": ["Sim", "Nao", "SIM", "não"]}
        assert types_of(data)["Ativo"] == "boolean"
        assert values_of(data, "Ativo") == [True, False, True, False]

    def test_zero_e_um_sao_numeros_e_nao_booleanos(self) -> None:
        # "0"/"1" aparecem como numero muito mais vezes do que como booleano.
        assert types_of({"Codigo": ["0", "1", "1", "0"]})["Codigo"] == "number"


class TestTiposNativos:
    def test_numero_nativo_do_excel(self) -> None:
        assert types_of({"Quantidade": [1, 2, 3]})["Quantidade"] == "number"

    def test_data_nativa_do_excel(self) -> None:
        import datetime

        data = {"Data": [datetime.date(2026, 9, 8)]}
        assert types_of(data)["Data"] == "date"

    def test_valor_nativo_com_cabecalho_monetario(self) -> None:
        assert types_of({"Valor total": [10.5, 20.3]})["Valor total"] == "currency"


@pytest.mark.parametrize(
    ("header", "esperado"),
    [("Valor da operacao", True), ("Preço", True), ("Documento", False), ("Status", False)],
)
def test_deteccao_de_coluna_monetaria_pelo_cabecalho(header: str, esperado: bool) -> None:
    strategy = infer_strategy(header, pl.Series(header, ["10.00", "20.00"]))
    assert (strategy.column_type == "currency") is esperado


class TestIdentificadores:
    """Colunas de codigo nao podem virar numero: o zero a esquerda se perde."""

    def test_agencia_com_zero_a_esquerda_continua_texto(self) -> None:
        data = {"Agencia": ["0001", "0442", "1287"]}
        assert types_of(data)["Agencia"] == "text"
        assert values_of(data, "Agencia") == ["0001", "0442", "1287"]

    def test_conta_com_zeros(self) -> None:
        assert types_of({"Conta": ["00012345", "00098765"]})["Conta"] == "text"

    def test_cpf_sem_pontuacao_com_zero(self) -> None:
        assert types_of({"CPF": ["01234567890", "09876543210"]})["CPF"] == "text"

    def test_codigo_longo_demais_para_float_continua_texto(self) -> None:
        # 44 digitos: converter para float perderia precisao silenciosamente.
        assert types_of({"Codigo": ["8" * 44, "7" * 44]})["Codigo"] == "text"

    def test_numero_normal_continua_numero(self) -> None:
        # A regra do zero a esquerda nao pode transformar valor legitimo em texto.
        assert types_of({"Quantidade": ["10", "250", "1"]})["Quantidade"] == "number"

    def test_decimal_menor_que_um_continua_numero(self) -> None:
        # "0,73" tem zero a esquerda mas e um decimal, nao um codigo.
        assert types_of({"Taxa": ["0,73", "2,48", "4,19"]})["Taxa"] == "number"
        assert values_of({"Taxa": ["0,73", "2,48"]}, "Taxa") == [0.73, 2.48]
