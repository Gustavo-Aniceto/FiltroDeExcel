"""Testes do compilador de Receitas.

Estes testes rodam SQL de verdade contra um Parquet de verdade. Testar a string
SQL gerada verificaria que o compilador escreve o que eu escrevi -- e nao que o
resultado esta correto. O que importa e o numero que chega ao relatorio.
"""

from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import pytest

os.environ.setdefault("ENGINE_SHARED_SECRET", "segredo-de-teste-com-tamanho-ok")

from app.engine.compiler import CompilationError  # noqa: E402
from app.engine.executor import ExecutionError, run_page  # noqa: E402
from app.engine.metrics import compute_metrics  # noqa: E402
from app.engine.schema import DatasetSchema  # noqa: E402

SCHEMA = DatasetSchema.from_pairs(
    [
        ("Documento", "text"),
        ("Status", "text"),
        ("Valor", "currency"),
        ("Data", "date"),
        ("Ativo", "boolean"),
        ("Obs", "text"),
    ]
)


@pytest.fixture(scope="module")
def parquet(tmp_path_factory) -> Path:
    """Base pequena e CONHECIDA: cada assert confere um numero calculado a mao."""
    import datetime

    frame = pl.DataFrame(
        {
            "Documento": ["A1", "A2", "A3", "A1", "A4", "A5"],  # A1 duplicado
            "Status": ["APROVADO", "APROVADO", "PENDENTE", "APROVADO", "RECUSADO", "aprovado"],
            "Valor": [100.0, 5000.0, 8000.0, 100.0, 250.0, 1500.0],
            "Data": [
                datetime.datetime(2026, 1, 15),
                datetime.datetime(2026, 2, 20),
                datetime.datetime(2026, 3, 10),
                datetime.datetime(2026, 1, 15),
                datetime.datetime(2026, 9, 1),
                datetime.datetime(2026, 5, 5),
            ],
            "Ativo": [True, True, False, True, False, True],
            "Obs": ["ok", None, "revisar", "ok", "", "conferido"],
        }
    )
    path = tmp_path_factory.mktemp("data") / "base.parquet"
    frame.write_parquet(path)
    return path


def recipe(*steps: dict) -> dict:
    return {"version": 1, "steps": list(steps), "metrics": []}


def filter_step(node: dict) -> dict:
    return {"kind": "filter", "filter": node}


def cond(column: str, operator: str, **kwargs) -> dict:
    return {"type": "condition", "column": column, "operator": operator, **kwargs}


def group(logic: str, *children: dict, negate: bool = False) -> dict:
    node = {"type": "group", "logic": logic, "children": list(children)}
    if negate:
        node["negate"] = True
    return node


def count_of(parquet: Path, rcp: dict) -> int:
    return run_page(parquet, SCHEMA, rcp, page=1, page_size=100).total_rows


class TestFiltrosBasicos:
    def test_sem_filtro_devolve_tudo(self, parquet: Path) -> None:
        assert count_of(parquet, recipe()) == 6

    def test_igualdade_ignora_maiusculas(self, parquet: Path) -> None:
        # "aprovado" e "APROVADO" sao o MESMO status para quem preencheu a
        # planilha. Diferenciar devolveria 3 em vez de 4 e o usuario nao teria
        # como saber por que faltou uma linha.
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Status", "equals", value="APROVADO"))))) == 4

    def test_igualdade_sensivel_a_caixa_quando_pedido(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Status", "equals", value="APROVADO", caseSensitive=True))))) == 3

    def test_diferente_de_inclui_vazios(self, parquet: Path) -> None:
        # Uma celula vazia E diferente de "ok". Excluir os nulos faria a linha
        # sumir do resultado sem explicacao.
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Obs", "not_equals", value="ok"))))) == 4

    def test_maior_que(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Valor", "greater_than", value=1000))))) == 3

    def test_valor_numerico_como_texto_e_convertido(self, parquet: Path) -> None:
        # O usuario digita num campo de texto. Comparar "1000" com numero
        # devolveria resultado errado silenciosamente.
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Valor", "greater_than", value="1000"))))) == 3

    def test_valor_no_formato_brasileiro(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Valor", "greater_than", value="1.000,00"))))) == 3

    def test_entre_com_extremos_invertidos(self, parquet: Path) -> None:
        # Digitar o intervalo ao contrario e engano comum; normalizar e melhor
        # do que devolver zero resultado sem dizer por que.
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Valor", "between", range=[8000, 100]))))) == 6

    def test_esta_vazio_pega_nulo_e_texto_em_branco(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Obs", "is_empty"))))) == 2

    def test_booleano(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Ativo", "is_true"))))) == 4


class TestFiltrosDeTexto:
    def test_contem(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Status", "contains", value="PROV"))))) == 4

    def test_nao_contem_inclui_vazios(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Obs", "not_contains", value="ok"))))) == 4

    def test_curinga_do_like_e_escapado(self, parquet: Path) -> None:
        # Buscar "%" deve procurar o caractere literal. Sem escape, "%" seria
        # curinga e traria a base inteira -- o usuario nao sabe o que e LIKE.
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Status", "contains", value="%"))))) == 0

    def test_esta_em_lista(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(
            group("AND", cond("Status", "in", values=["PENDENTE", "RECUSADO"]))))) == 2


class TestLogicaCombinada:
    def test_e(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(group(
            "AND",
            cond("Status", "equals", value="APROVADO"),
            cond("Valor", "greater_than", value=1000),
        )))) == 2

    def test_ou_de_dois_grupos_e(self, parquet: Path) -> None:
        # (APROVADO E >1000) OU (PENDENTE E >7000) -- o caso que motivou a
        # arvore de filtros em vez de uma lista plana.
        assert count_of(parquet, recipe(filter_step(group(
            "OR",
            group("AND",
                  cond("Status", "equals", value="APROVADO"),
                  cond("Valor", "greater_than", value=1000)),
            group("AND",
                  cond("Status", "equals", value="PENDENTE"),
                  cond("Valor", "greater_than", value=7000)),
        )))) == 3

    def test_negacao_de_grupo(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(group(
            "AND", cond("Status", "equals", value="APROVADO"), negate=True,
        )))) == 2

    def test_grupo_vazio_nao_filtra(self, parquet: Path) -> None:
        # A interface comeca com um grupo vazio. Tratar como "nenhum resultado"
        # deixaria a tela em branco antes de o usuario fazer qualquer coisa.
        assert count_of(parquet, recipe(filter_step(group("AND")))) == 6


class TestDatas:
    def test_periodo_inclui_o_ultimo_dia(self, parquet: Path) -> None:
        # Quem escolhe "01/01 a 15/01" espera o dia 15 inteiro, e nao os
        # registros ate a meia-noite do dia 15.
        assert count_of(parquet, recipe(filter_step(group(
            "AND", cond("Data", "date_between", range=["2026-01-01", "2026-01-15"]),
        )))) == 2

    def test_antes_de(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(group(
            "AND", cond("Data", "date_before", value="2026-03-01"),
        )))) == 3

    def test_depois_de_exclui_o_proprio_dia(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(filter_step(group(
            "AND", cond("Data", "date_after", value="2026-05-05"),
        )))) == 1


class TestTratamento:
    def test_remove_duplicados_por_coluna(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(
            {"kind": "drop_duplicates", "columns": ["Documento"], "keep": "first"})) == 5

    def test_remove_todas_as_ocorrencias(self, parquet: Path) -> None:
        # keep='none' descarta as duas linhas de A1, nao apenas a repetida:
        # serve a auditoria, que quer isolar o registro problematico.
        assert count_of(parquet, recipe(
            {"kind": "drop_duplicates", "columns": ["Documento"], "keep": "none"})) == 4

    def test_manter_primeira_e_deterministico(self, parquet: Path) -> None:
        # Duas execucoes da MESMA receita sobre o MESMO arquivo tem de produzir
        # o mesmo resultado. Sem ancora de ordem, "a primeira" seria arbitraria.
        rcp = recipe(
            {"kind": "drop_duplicates", "columns": ["Documento"], "keep": "first"},
            {"kind": "sort", "by": [{"column": "Documento", "direction": "asc"}]},
        )
        primeira = run_page(parquet, SCHEMA, rcp, 1, 10).rows
        segunda = run_page(parquet, SCHEMA, rcp, 1, 10).rows
        assert primeira == segunda

    def test_seleciona_colunas(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "select_columns", "columns": ["Documento", "Valor"]}), 1, 10)
        assert page.columns == ["Documento", "Valor"]

    def test_coluna_sintetica_de_ordem_nunca_aparece(self, parquet: Path) -> None:
        # __ef_row e detalhe interno. Vazar para a grade ou para a exportacao
        # colocaria uma coluna sem sentido no arquivo entregue.
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "drop_duplicates", "columns": ["Documento"], "keep": "first"}), 1, 10)
        assert not any(name.startswith("__ef") for name in page.columns)
        assert not any(k.startswith("__ef") for k in page.rows[0])

    def test_renomeia_colunas(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "rename_columns", "mapping": [{"from": "Valor", "to": "Valor da operacao"}]}),
            1, 10)
        assert "Valor da operacao" in page.columns

    def test_renomear_para_nome_repetido_e_recusado(self, parquet: Path) -> None:
        with pytest.raises(ExecutionError, match="mesmo nome"):
            run_page(parquet, SCHEMA, recipe(
                {"kind": "rename_columns", "mapping": [{"from": "Valor", "to": "Status"}]}), 1, 10)

    def test_ordena_com_vazios_no_fim(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "sort", "by": [{"column": "Obs", "direction": "asc"}]}), 1, 10)
        assert page.rows[-1]["Obs"] is None

    def test_preenche_vazios(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "fill_empty", "column": "Obs", "value": "SEM OBSERVACAO"}), 1, 10)
        assert all(row["Obs"] for row in page.rows)

    def test_remove_linhas_vazias(self, parquet: Path) -> None:
        assert count_of(parquet, recipe(
            {"kind": "drop_empty_rows", "columns": ["Obs"], "mode": "any"})) == 4

    def test_pipeline_encadeado(self, parquet: Path) -> None:
        # O caso de uso real: filtrar, remover duplicados e ficar so com o que
        # interessa. A ordem importa e precisa ser respeitada.
        page = run_page(parquet, SCHEMA, recipe(
            filter_step(group("AND", cond("Status", "equals", value="APROVADO"))),
            {"kind": "drop_duplicates", "columns": ["Documento"], "keep": "first"},
            {"kind": "select_columns", "columns": ["Documento", "Valor"]},
            {"kind": "sort", "by": [{"column": "Valor", "direction": "desc"}]},
        ), 1, 10)
        assert page.total_rows == 3
        assert page.columns == ["Documento", "Valor"]
        assert [r["Valor"] for r in page.rows] == [5000.0, 1500.0, 100.0]


class TestMetricas:
    def test_soma_sobre_o_resultado_do_filtro(self, parquet: Path) -> None:
        results = compute_metrics(
            parquet, SCHEMA,
            recipe(filter_step(group("AND", cond("Status", "equals", value="APROVADO")))),
            [{"id": "s", "operation": "sum", "column": "Valor"}],
        )
        assert results[0]["value"] == pytest.approx(6700.0)  # 100+5000+100+1500

    def test_varias_metricas_de_uma_vez(self, parquet: Path) -> None:
        results = compute_metrics(
            parquet, SCHEMA, recipe(),
            [
                {"id": "c", "operation": "count"},
                {"id": "s", "operation": "sum", "column": "Valor"},
                {"id": "a", "operation": "avg", "column": "Valor"},
                {"id": "mx", "operation": "max", "column": "Valor"},
                {"id": "mn", "operation": "min", "column": "Valor"},
                {"id": "d", "operation": "count_distinct", "column": "Documento"},
                {"id": "e", "operation": "count_empty", "column": "Obs"},
            ],
        )
        by_id = {r["id"]: r["value"] for r in results}
        assert by_id["c"] == 6
        assert by_id["s"] == pytest.approx(14950.0)
        assert by_id["mx"] == pytest.approx(8000.0)
        assert by_id["mn"] == pytest.approx(100.0)
        assert by_id["d"] == 5
        assert by_id["e"] == 2

    def test_percentual_e_sobre_o_total_original(self, parquet: Path) -> None:
        # 4 aprovados de 6 = 66,7%. Se fosse sobre o resultado, daria sempre
        # 100% e nao responderia nada.
        results = compute_metrics(
            parquet, SCHEMA,
            recipe(filter_step(group("AND", cond("Status", "equals", value="APROVADO")))),
            [{"id": "p", "operation": "percentage"}],
        )
        assert results[0]["value"] == pytest.approx(66.67, abs=0.01)

    def test_media_de_coluna_de_texto_e_recusada_com_mensagem_util(self, parquet: Path) -> None:
        results = compute_metrics(
            parquet, SCHEMA, recipe(), [{"id": "a", "operation": "avg", "column": "Status"}])
        assert results[0]["value"] is None
        assert "nao contem valores numericos" in results[0]["error"]

    def test_metrica_invalida_nao_derruba_as_demais(self, parquet: Path) -> None:
        # Uma coluna renomeada na planilha nao pode apagar as outras analises
        # da tela.
        results = compute_metrics(
            parquet, SCHEMA, recipe(),
            [
                {"id": "ruim", "operation": "sum", "column": "NaoExiste"},
                {"id": "boa", "operation": "count"},
            ],
        )
        by_id = {r["id"]: r for r in results}
        assert by_id["ruim"]["error"] is not None
        assert by_id["boa"]["value"] == 6


class TestSeguranca:
    def test_coluna_inexistente_e_recusada(self, parquet: Path) -> None:
        with pytest.raises(ExecutionError, match="nao existe"):
            run_page(parquet, SCHEMA, recipe(filter_step(
                group("AND", cond("NaoExiste", "equals", value="x")))), 1, 10)

    def test_nome_de_coluna_com_sql_e_tratado_como_texto(self, parquet: Path) -> None:
        # A defesa nao e escapar a string: e a coluna nao existir no esquema.
        with pytest.raises(ExecutionError, match="nao existe"):
            run_page(parquet, SCHEMA, recipe(filter_step(
                group("AND", cond('"; DROP TABLE users; --', "equals", value="x")))), 1, 10)

    def test_valor_com_sql_e_apenas_um_valor(self, parquet: Path) -> None:
        # Parametro vinculado: o texto e comparado literalmente, nunca executado.
        assert count_of(parquet, recipe(filter_step(group(
            "AND", cond("Status", "equals", value="' OR 1=1 --"))))) == 0

    def test_operador_desconhecido_e_recusado(self, parquet: Path) -> None:
        with pytest.raises(ExecutionError, match="[Oo]perador"):
            run_page(parquet, SCHEMA, recipe(filter_step(
                group("AND", cond("Status", "quase_igual", value="x")))), 1, 10)

    def test_passo_desconhecido_e_recusado(self, parquet: Path) -> None:
        with pytest.raises(ExecutionError, match="[Oo]peracao desconhecida"):
            run_page(parquet, SCHEMA, recipe({"kind": "executar_sql"}), 1, 10)


class TestPaginacao:
    def test_pagina_limita_as_linhas_devolvidas(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(), page=1, page_size=2)
        assert len(page.rows) == 2
        # O TOTAL continua sendo o do resultado inteiro: e o que a interface
        # mostra em "1-2 de 6".
        assert page.total_rows == 6

    def test_segunda_pagina(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(
            {"kind": "sort", "by": [{"column": "Valor", "direction": "asc"}]}), page=2, page_size=2)
        assert [r["Valor"] for r in page.rows] == [250.0, 1500.0]

    def test_busca_livre_procura_em_todas_as_colunas(self, parquet: Path) -> None:
        page = run_page(parquet, SCHEMA, recipe(), 1, 10, search="revisar")
        assert page.total_rows == 1

    def test_resultado_vazio_mantem_as_colunas(self, parquet: Path) -> None:
        # Sem as colunas, a grade sumiria da tela em vez de mostrar "nenhum
        # registro encontrado" com o cabecalho no lugar.
        page = run_page(parquet, SCHEMA, recipe(filter_step(
            group("AND", cond("Status", "equals", value="INEXISTENTE")))), 1, 10)
        assert page.total_rows == 0
        assert page.rows == []
