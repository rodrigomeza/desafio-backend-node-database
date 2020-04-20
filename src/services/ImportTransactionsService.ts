import csvParse from 'csv-parse';
import fs from 'fs';
import { getCustomRepository, getRepository, In } from 'typeorm';
import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionsRepository from '../repositories/TransactionsRepository';

interface Request {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const transactionsReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2,
    });
    const parseCSV = transactionsReadStream.pipe(parsers);

    const transactions: Request[] = [];
    const categories: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    // Espera o fim da busca por informações no arquivo e rejeita em caso de erro no arquivo
    await new Promise((resolve, reject) => {
      parseCSV.on('error', err => reject(err));
      parseCSV.on('end', resolve);
    });

    // Busca por categorias existentes no banco e comparando com o arquivo
    const existentCategories = await categoriesRepository.find({
      where: { title: In(categories) },
    });

    // Recupera todos os titulos das categorias existentes
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // Adiciona as categorias inexistentes no banco mas eliminando os duplicados
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    // Cria as novas categorias no repositorio
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    // Salva as novas categorias no banco de dados
    await categoriesRepository.save(newCategories);

    // Construi um array com todas as categorias, as novas e existentes
    const finalCategories = [...newCategories, ...existentCategories];

    // Cria as transações com as respectivas categorias
    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        value: transaction.value,
        type: transaction.type,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    // Salva as transações no banco
    await transactionsRepository.save(createdTransactions);

    // apaga os arquivos
    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
