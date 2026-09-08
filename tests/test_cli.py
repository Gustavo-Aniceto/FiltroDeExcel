import pytest

from filtro.cli import formatar_tabela, main
from filtro.planilha import Planilha, ler

CSV = (
    "Cliente;Estado;Valor;Data;Status\n"
    "Ana Souza;SP;7500;2024-01-15;Pago\n"
    "Bruno Lima;RJ;2400;2024-01-22;Pendente\n"
    "Carla Dias;MG;1200;2024-02-03;Pago\n"
    "Diego Alves;SP;900;2024-02-11;Cancelado\n"
)


@pytest.fixture
def entrada(tmp_path):
    caminho = tmp_path / "vendas.csv"
    caminho.write_text(CSV, encoding="utf-8")
    return caminho


def test_previa_no_terminal(entrada, capsys):
    assert main([str(entrada), "--onde", "Estado = SP"]) == 0
    saida = capsys.readouterr().out
    assert "Ana Souza" in saida
    assert "Bruno Lima" not in saida
    assert "2 de 4 linhas" in saida


def test_grava_csv(entrada, tmp_path, capsys):
    destino = tmp_path / "saida.csv"
    assert main([str(entrada), "--onde", "Valor > 1000", "-o", str(destino)]) == 0
    assert str(destino) in capsys.readouterr().out
    resultado = ler(destino)
    assert resultado.colunas == ["Cliente", "Estado", "Valor", "Data", "Status"]
    assert [linha[0] for linha in resultado.linhas] == ["Ana Souza", "Bruno Lima", "Carla Dias"]


def test_grava_xlsx_com_colunas_e_ordem(entrada, tmp_path):
    destino = tmp_path / "saida.xlsx"
    codigo = main(
        [
            str(entrada),
            "--onde", "Status contem pa",
            "--colunas", "Cliente,Valor",
            "--ordenar", "Valor:desc",
            "-o", str(destino),
        ]
    )
    assert codigo == 0
    resultado = ler(destino)
    assert resultado.colunas == ["Cliente", "Valor"]
    assert [linha[0] for linha in resultado.linhas] == ["Ana Souza", "Carla Dias"]


def test_modo_ou(entrada, capsys):
    main([str(entrada), "--onde", "Estado = MG", "--onde", "Valor > 5000", "--modo", "ou"])
    saida = capsys.readouterr().out
    assert "2 de 4 linhas" in saida


def test_inverter(entrada, capsys):
    main([str(entrada), "--onde", "Estado = SP", "--inverter", "--contar"])
    assert capsys.readouterr().out.strip() == "2"


def test_contar(entrada, capsys):
    main([str(entrada), "--onde", "Valor >= 1200", "--contar"])
    assert capsys.readouterr().out.strip() == "3"


def test_listar_colunas(entrada, capsys):
    assert main([str(entrada), "--listar-colunas"]) == 0
    saida = capsys.readouterr().out
    assert "1. Cliente" in saida
    assert "5. Status" in saida


def test_limite_e_max_linhas(entrada, capsys):
    main([str(entrada), "--max-linhas", "2"])
    saida = capsys.readouterr().out
    assert "+2 linhas" in saida


def test_sem_resultados(entrada, capsys):
    assert main([str(entrada), "--onde", "Estado = BA"]) == 0
    assert "nenhuma linha passou no filtro." in capsys.readouterr().out


def test_condicao_invalida_retorna_erro(entrada, capsys):
    assert main([str(entrada), "--onde", "Estado SP"]) == 2
    assert "erro:" in capsys.readouterr().err


def test_coluna_inexistente_retorna_erro(entrada, capsys):
    assert main([str(entrada), "--onde", "Cidade = Recife"]) == 2
    erro = capsys.readouterr().err
    assert "não existe" in erro
    assert "Cliente" in erro


def test_arquivo_inexistente_retorna_erro(tmp_path, capsys):
    assert main([str(tmp_path / "sumiu.csv")]) == 2
    assert "não encontrado" in capsys.readouterr().err


def test_comparacao_sensivel(entrada, capsys):
    main([str(entrada), "--onde", "Cliente contem ANA", "--contar"])
    assert capsys.readouterr().out.strip() == "1"
    main([str(entrada), "--onde", "Cliente contem ANA", "--sensivel", "--contar"])
    assert capsys.readouterr().out.strip() == "0"


def test_delimitador_de_saida(entrada, tmp_path):
    destino = tmp_path / "saida.csv"
    main([str(entrada), "-o", str(destino), "--delimitador", ","])
    assert destino.read_text(encoding="utf-8-sig").splitlines()[0] == "Cliente,Estado,Valor,Data,Status"


def test_formatar_tabela_alinha_numeros():
    planilha = Planilha(["Nome", "Valor"], [["Ana", 7], ["Bruno", 1234]])
    linhas = formatar_tabela(planilha).splitlines()
    assert linhas[0] == "Nome   Valor"
    assert linhas[2] == "Ana        7"
    assert linhas[3] == "Bruno   1234"
