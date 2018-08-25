import { IToken } from '../lexer/token';
import {
  chain,
  ChainNode,
  ChainNodeFactory,
  execChain,
  many,
  matchNumber,
  matchString,
  matchWord,
  optional,
  plus,
  Scanner
} from '../parser';
import { binaryRecursionToArray } from '../parser/utils';
import { createFourOperations } from './four-operations';

const unaryOperator = ['!', '~', '+', '-', 'NOT'];
const bitOperator = ['<<', '>>', '&', '^', '|'];
const mathOperator = ['*', '/', '%', 'DIV', 'MOD', '+', '-', '--'];

function root() {
  return chain(statements, optional(';'))(ast => ast[0]);
}

function statements() {
  return chain(statement, many(';', statement))(binaryRecursionToArray);
}

function statement() {
  return chain([
    selectStatement,
    createTableStatement,
    insertStatement,
    createViewStatement,
    setStatement,
    indexStatement
  ])(ast => ast[0]);
}

// ----------------------------------- select statement -----------------------------------

function selectStatement() {
  return chain(
    'select',
    selectList,
    fromClause,
    optional(orderByClause),
    optional(limitClause),
    optional(union, selectStatement)
  )(ast => {
    const result: any = {
      type: 'statement',
      variant: 'select',
      result: ast[1],
      from: ast[2]
    };

    return result;
  });
}

function union() {
  return chain('union', ['all', 'distinct'])();
}

function fromClause() {
  return chain('from', tableSources, optional(whereStatement), optional(groupByStatement))();
}

function selectList() {
  return chain(selectField, many(',', selectField))(ast => {
    return ast;
  });
}

function whereStatement() {
  return chain('where', expression)(ast => ast[1]);
}

// selectField
//         ::= not? field alias?
//         ::= not? ( field ) alias?
//           | caseStatement alias?
//           | *
function selectField() {
  return chain([
    chain([chain(many('not'), field)(), chain(many('not'), '(', field, ')')(), caseStatement], optional(alias))(),
    '*'
  ])();
}

// fieldList
//       ::= field (, fieldList)?
function fieldList() {
  return chain(field, many(',', field))();
}

function tableSources() {
  return chain(tableSource, many(',', tableSource))();
}

function tableSource() {
  return chain(
    [chain(tableSourceItem, many(joinPart))(), chain('(', tableSourceItem, many(joinPart), ')')()],
    optional(alias)
  )();
}

function tableSourceItem() {
  return chain([
    chain(tableName, optional(alias))(),
    chain([selectStatement, chain('(', selectStatement, ')')()], optional(alias))(),
    chain('(', tableSources, ')')()
  ])();
}

function joinPart() {
  return chain([
    chain(['inner', 'cross'], 'join', tableSourceItem, optional('on', expression))(),
    chain('straight_join', tableSourceItem, optional('on', expression))(),
    chain(['left', 'right'], optional('outer'), 'join', tableSourceItem, optional('on', expression))(),
    chain('natural', optional(['left', 'right'], optional('outer')), 'join', tableSourceItem)()
  ])();
}

// Alias ::= AS WordOrString
//         | WordOrString
function alias() {
  return chain([chain('as', stringOrWord)(), stringOrWord])();
}

// ----------------------------------- Create table statement -----------------------------------
function createTableStatement() {
  return chain('create', 'table', stringOrWord, '(', tableOptions, ')')();
}

function tableOptions() {
  return chain(tableOption, many(',', tableOption))();
}

function tableOption() {
  return chain(stringOrWord, dataType)();
}

function tableName() {
  return chain([wordChain, chain(wordChain, '.', wordChain)()])();
}

// ----------------------------------- Create view statement -----------------------------------
function createViewStatement() {
  return chain('create', 'view', wordChain, 'as', selectStatement)();
}

// ----------------------------------- Insert statement -----------------------------------
function insertStatement() {
  return chain('insert', optional('ignore'), 'into', tableName, optional(selectFieldsInfo), [selectStatement])();
}

function selectFieldsInfo() {
  return chain('(', selectFields, ')')();
}

function selectFields() {
  return chain(wordChain, many(',', wordChain))();
}

// ----------------------------------- groupBy -----------------------------------
function groupByStatement() {
  return chain('group', 'by', fieldList)();
}

// ----------------------------------- orderBy -----------------------------------
function orderByClause() {
  return chain('order', 'by', fieldList)();
}

function orderByExpressionList() {
  return chain(orderByExpression, optional(',', orderByExpressionList))();
}

function orderByExpression() {
  return chain(expression, ['asc', 'desc'])();
}

// ----------------------------------- limit -----------------------------------
function limitClause() {
  return chain('limit', [
    numberChain,
    chain(numberChain, ',', numberChain)(),
    chain(numberChain, 'offset', numberChain)()
  ])();
}

// ----------------------------------- Function -----------------------------------
function functionChain() {
  return chain([castFunction, normalFunction, ifFunction])();
}

function functionFields() {
  return chain(functionFieldItem, many(',', functionFieldItem))();
}

function functionFieldItem() {
  return chain(many(selectSpec), [field, caseStatement])();
}

function ifFunction() {
  return chain('if', '(', predicate, ',', field, ',', field, ')')();
}

function castFunction() {
  return chain('cast', '(', wordChain, 'as', dataType, ')')();
}

function normalFunction() {
  return chain(wordChain, '(', optional(functionFields), ')')();
}

// ----------------------------------- Case -----------------------------------
function caseStatement() {
  return chain('case', plus(caseAlternative), optional('else', [stringChain, 'null', numberChain]), 'end')();
}

function caseAlternative() {
  return chain('when', expression, 'then', fieldItem)();
}

// ----------------------------------- set statement -----------------------------------

function setStatement() {
  return chain('set', [variableAssignments])();
}

function variableAssignments() {
  return chain(variableAssignment, many(',', variableAssignment))();
}

function variableAssignment() {
  return chain(fieldItem, '=', [fieldItem, 'true'])();
}

// ----------------------------------- Utils -----------------------------------

// TODO: https://github.com/antlr/grammars-v4/blob/master/mysql/MySqlParser.g4#L1963
function dataType() {
  return chain([
    chain(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext']),
    chain(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint']),
    chain(['real', 'double', 'float']),
    chain(['decimal', 'numberic']),
    chain(['date', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bool', 'boolean']),
    chain(['bit', 'time', 'timestamp', 'datetime', 'binary', 'varbinary', 'year']),
    chain(['enum', 'set']),
    chain('geometrycollection', 'linestring', 'multilinestring', 'multipoint', 'multipolygon', 'point', 'polygon')
  ])(ast => ast[0]);
}



// ----------------------------------- Expression -----------------------------------

/*
 * expr:
 *   expr OR expr
 * | expr || expr
 * | expr XOR expr
 * | expr AND expr
 * | expr && expr
 * | NOT expr
 * | ! expr
 * | boolean_primary IS [NOT] {TRUE | FALSE | UNKNOWN}
 * | boolean_primary 
**/

function expression() {
  return chain(expressionHead, many(logicalOperator, expression))();
}

function expressionHead() {
  return chain([
    chain('(', expression, ')')(),
    chain(notOperator, expression)(),
    chain(booleanPrimary, optional(chain('is', optional('not'), ['true', 'false', 'unknown'])()))
  ])();
}

/*
 *boolean_primary:
 *   boolean_primary IS [NOT] NULL
 * | boolean_primary <=> predicate
 * | boolean_primary comparison_operator predicate
 * | boolean_primary comparison_operator {ALL | ANY} (subquery)
 * | predicate
**/
function booleanPrimary() {
  return chain(
    predicate,
    many([
      'isnull',
      chain(optional('is'), optional('not'), ['null', field])(),
      chain(comparisonOperator, predicate)()
      // chain(comparisonOperator, ['ALL',  'ANY'], (subquery))
    ])
  )();
}

/*
 * predicate:
 *    field SOUNDS LIKE field
 *  | field [NOT] IN (subquery)
 *  | field [NOT] IN (expr [, expr] ...)
 *  | field [NOT] BETWEEN field AND predicate
 *  | field [NOT] LIKE simple_expr [ESCAPE simple_expr]
 *  | field [NOT] REGEXP field
 *  | field
**/
function predicate() {
  return chain(
    field,
    optional([chain(comparisonOperator, [field, 'null'])(), chain('sounds', 'like', field)(), isOrNotExpression])
  )();
}

function isOrNotExpression() {
  return chain(optional('is'), optional('not'), [
    chain('in', '(', fieldList, ')')(),
    chain('between', field, 'and', predicate)(),
    chain('like', field, optional('escape', field))(),
    chain('regexp', field)()
    // 'null',
    // 'isnull',
    // field
  ])();
}

function fieldItem() {
  return chain([
    functionChain,
    chain(stringOrWordOrNumber, [optional('.', '*'), plus('.', stringOrWordOrNumber)])(), // 字段
    '*'
  ])(ast => ast[0]);
}

function field() {
  return createFourOperations(fieldItem)();
}

// ----------------------------------- create index expression -----------------------------------
function indexStatement() {
  return chain('CREATE', 'INDEX', indexItem, onStatement, whereStatement)();
}

// 所印象
function indexItem() {
  return chain(stringChain, many('.', stringChain))();
}

// on子表达式
function onStatement() {
  return chain('ON', stringChain, '(', fieldForIndexList, ')')();
}

function fieldForIndex() {
  return chain(stringChain, optional(['ASC', 'DESC']))();
}

function fieldForIndexList() {
  return chain(fieldForIndex, many(',', fieldForIndex))();
}

// ----------------------------------- Terminals -----------------------------------

function wordChain() {
  return chain(matchWord())(ast => ast[0]);
}

function stringChain() {
  return chain(matchString())(ast => ast[0]);
}

function numberChain() {
  return chain(matchNumber())(ast => ast[0]);
}

function stringOrWord() {
  return chain([wordChain, stringChain])(ast => ast[0]);
}

function stringOrWordOrNumber() {
  return chain([wordChain, stringChain, numberChain])(ast => ast[0]);
}

// 逻辑运算式
function logicalOperator() {
  return chain(['and', '&&', 'xor', 'or', '||'])(ast => ast[0]);
}

// 比较
function comparisonOperator() {
  return chain(['=', '>', '<', '<=', '>=', '<>', '!=', '<=>'])(ast => ast[0]);
}

function notOperator() {
  return chain(['not', '!'])(ast => ast[0]);
}

function selectSpec() {
  return chain([
    'all',
    'distinct',
    'distinctrow',
    'high_priority',
    'straight_join',
    'sql_small_result',
    'sql_big_result',
    'sql_buffer_result',
    'sql_cache',
    'sql_no_cache',
    'sql_calc_found_rows'
  ])(ast => ast[0]);
}

export class SQLAstParser {
  public rootChainNode: ChainNode;

  constructor() {
    this.rootChainNode = root()();
  }

  public parse = (tokens: IToken[], cursorPosition = 0) => {
    const scanner = new Scanner(tokens);
    return execChain(this.rootChainNode, scanner, cursorPosition, ast => ast[0]);
  };
}
