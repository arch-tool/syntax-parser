import { escapeRegExp, isEmpty } from 'lodash';
import { IToken } from './token';
import tokenTypes from './token-types';

export class Tokenizer {
  private WHITESPACE_REGEX: RegExp | false;
  private NUMBER_REGEX: RegExp | false;
  private OPERATOR_REGEX: RegExp | false;
  private BLOCK_COMMENT_REGEX: RegExp | false;
  private LINE_COMMENT_REGEX: RegExp | false;
  private RESERVED_TOPLEVEL_REGEX: RegExp | false;
  private RESERVED_NEWLINE_REGEX: RegExp | false;
  private RESERVED_PLAIN_REGEX: RegExp | false;
  private WORD_REGEX: RegExp | false;
  private STRING_REGEX: RegExp | false;
  private OPEN_PAREN_REGEX: RegExp | false;
  private CLOSE_PAREN_REGEX: RegExp | false;
  private INDEXED_PLACEHOLDER_REGEX: RegExp | false;
  private IDENT_NAMED_PLACEHOLDER_REGEX: RegExp | false;
  private STRING_NAMED_PLACEHOLDER_REGEX: RegExp | false;

  /**
   * @param {Object} cfg
   *  @param {String[]} cfg.reservedWords Reserved words in SQL
   *  @param {String[]} cfg.reservedToplevelWords Words that are set to new line separately
   *  @param {String[]} cfg.reservedNewlineWords Words that are set to newline
   *  @param {String[]} cfg.stringTypes String types to enable: "", '', ``, [], N''
   *  @param {String[]} cfg.openParens Opening parentheses to enable, like (, [
   *  @param {String[]} cfg.closeParens Closing parentheses to enable, like ), ]
   *  @param {String[]} cfg.indexedPlaceholderTypes Prefixes for indexed placeholders, like ?
   *  @param {String[]} cfg.namedPlaceholderTypes Prefixes for named placeholders, like @ and :
   *  @param {String[]} cfg.lineCommentTypes Line comments to enable, like # and --
   *  @param {String[]} cfg.wordChars Special chars that can be found inside of words, like @ and #
   */
  constructor(cfg: any) {
    this.WHITESPACE_REGEX = /^(\s+)/;
    this.NUMBER_REGEX = /^([0-9]+(\.[0-9]+)?|0x[0-9a-fA-F]+|0b[01]+)\b/; // Ignore negative.
    this.OPERATOR_REGEX = /^(!=|<>|==|<=|>=|!<|!>|\|\||::|->>|->|~~\*|~~|!~~\*|!~~|~\*|!~\*|!~|.)/;

    this.BLOCK_COMMENT_REGEX = /^(\/\*[^]*?(?:\*\/|$))/;
    this.LINE_COMMENT_REGEX = this.createLineCommentRegex(cfg.lineCommentTypes);

    this.RESERVED_TOPLEVEL_REGEX = this.createReservedWordRegex(cfg.reservedToplevelWords);
    this.RESERVED_NEWLINE_REGEX = this.createReservedWordRegex(cfg.reservedNewlineWords);
    this.RESERVED_PLAIN_REGEX = this.createReservedWordRegex(cfg.reservedWords);

    this.WORD_REGEX = this.createWordRegex(cfg.wordChars);
    this.STRING_REGEX = this.createStringRegex(cfg.stringTypes);

    this.OPEN_PAREN_REGEX = this.createParenRegex(cfg.openParens);
    this.CLOSE_PAREN_REGEX = this.createParenRegex(cfg.closeParens);

    this.INDEXED_PLACEHOLDER_REGEX = this.createPlaceholderRegex(cfg.indexedPlaceholderTypes, '[0-9]*');
    this.IDENT_NAMED_PLACEHOLDER_REGEX = this.createPlaceholderRegex(cfg.namedPlaceholderTypes, cfg.indentRegex);
    this.STRING_NAMED_PLACEHOLDER_REGEX = this.createPlaceholderRegex(
      cfg.namedPlaceholderTypes,
      this.createStringPattern(cfg.stringTypes)
    );
  }

  /**
   * Takes a SQL string and breaks it into tokens.
   * Each token is an object with type and value.
   *
   * @param {String} input The SQL string
   * @return {Object[]} tokens An array of tokens.
   *  @return {String} token.type
   *  @return {String} token.value
   */
  public tokenize(input: string) {
    const tokens = [];
    let token: IToken;
    let lastPosition = 0;

    // Keep processing the string until it is empty
    while (input.length) {
      // Get the next token and the token type
      token = this.getNextToken(input, token);
      token.position = [lastPosition, lastPosition + token.value.length];
      lastPosition += token.value.length;

      // Advance the string
      input = input.substring(token.value.length);

      tokens.push(token);
    }
    return tokens;
  }

  private getNextToken(input: string, previousToken: IToken) {
    return (
      this.getWhitespaceToken(input) ||
      this.getCommentToken(input) ||
      this.getStringToken(input) ||
      this.getOpenParenToken(input) ||
      this.getCloseParenToken(input) ||
      this.getPlaceholderToken(input) ||
      this.getNumberToken(input) ||
      this.getReservedWordToken(input, previousToken) ||
      this.getWordToken(input) ||
      this.getOperatorToken(input)
    );
  }

  private createLineCommentRegex(lineCommentTypes: string[]) {
    return new RegExp(`^((?:${lineCommentTypes.map(c => escapeRegExp(c)).join('|')}).*?(?:\n|$))`);
  }

  private createReservedWordRegex(reservedWords: string[]) {
    const reservedWordsPattern = reservedWords.join('|').replace(/ /g, '\\s+');
    return new RegExp(`^(${reservedWordsPattern})\\b`, 'i');
  }

  private createWordRegex(specialChars: string[] = []) {
    return new RegExp(`^(${specialChars.join('|')})`);
  }

  private createStringRegex(stringTypes: string[]) {
    return new RegExp('^(' + this.createStringPattern(stringTypes) + ')');
  }

  // This enables the following string patterns:
  // 1. backtick quoted string using `` to escape
  // 2. square bracket quoted string (SQL Server) using ]] to escape
  // 3. double quoted string using "" or \" to escape
  // 4. single quoted string using '' or \' to escape
  // 5. national character quoted string using N'' or N\' to escape
  private createStringPattern(stringTypes: string[]) {
    const patterns: { [x: string]: string } = {
      '``': '((`[^`]*($|`))+)',
      '[]': '((\\[[^\\]]*($|\\]))(\\][^\\]]*($|\\]))*)',
      '""': '(("[^"\\\\]*(?:\\\\.[^"\\\\]*)*("|$))+)',
      "''": "(('[^'\\\\]*(?:\\\\.[^'\\\\]*)*('|$))+)",
      "N''": "((N'[^N'\\\\]*(?:\\\\.[^N'\\\\]*)*('|$))+)"
    };

    return stringTypes.map(t => patterns[t]).join('|');
  }

  private createParenRegex(parens: string[]) {
    return new RegExp('^(' + parens.map(p => this.escapeParen(p)).join('|') + ')', 'i');
  }

  private escapeParen(paren: string) {
    if (paren.length === 1) {
      // A single punctuation character
      return escapeRegExp(paren);
    } else {
      // longer word
      return '\\b' + paren + '\\b';
    }
  }

  private createPlaceholderRegex(types: string[], pattern: string) {
    if (isEmpty(types)) {
      return false;
    }
    const typesRegex = types.map(escapeRegExp).join('|');
    return new RegExp(`^((?:${typesRegex})(?:${pattern}))`);
  }

  private getWhitespaceToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.WHITESPACE,
      regex: this.WHITESPACE_REGEX
    });
  }

  private getCommentToken(input: string) {
    return this.getLineCommentToken(input) || this.getBlockCommentToken(input);
  }

  private getLineCommentToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.LINE_COMMENT,
      regex: this.LINE_COMMENT_REGEX
    });
  }

  private getBlockCommentToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.BLOCK_COMMENT,
      regex: this.BLOCK_COMMENT_REGEX
    });
  }

  private getStringToken(input: string) {
    return this.getTokenOnFirstMatch({ input, type: tokenTypes.STRING, regex: this.STRING_REGEX });
  }

  private getOpenParenToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.OPEN_PAREN,
      regex: this.OPEN_PAREN_REGEX
    });
  }

  private getCloseParenToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.CLOSE_PAREN,
      regex: this.CLOSE_PAREN_REGEX
    });
  }

  private getPlaceholderToken(input: string) {
    return (
      this.getIdentNamedPlaceholderToken(input) ||
      this.getStringNamedPlaceholderToken(input) ||
      this.getIndexedPlaceholderToken(input)
    );
  }

  private getIdentNamedPlaceholderToken(input: string) {
    return this.getPlaceholderTokenWithKey({
      input,
      regex: this.IDENT_NAMED_PLACEHOLDER_REGEX,
      parseKey: v => v.slice(1)
    });
  }

  private getStringNamedPlaceholderToken(input: string) {
    return this.getPlaceholderTokenWithKey({
      input,
      regex: this.STRING_NAMED_PLACEHOLDER_REGEX,
      parseKey: v => this.getEscapedPlaceholderKey({ key: v.slice(2, -1), quoteChar: v.slice(-1) })
    });
  }

  private getIndexedPlaceholderToken(input: string) {
    return this.getPlaceholderTokenWithKey({
      input,
      regex: this.INDEXED_PLACEHOLDER_REGEX,
      parseKey: v => v.slice(1)
    });
  }

  private getPlaceholderTokenWithKey({
    input,
    regex,
    parseKey
  }: {
    input: string;
    regex: boolean | RegExp;
    parseKey: (key: string) => string;
  }) {
    const token = this.getTokenOnFirstMatch({ input, regex, type: tokenTypes.PLACEHOLDER });
    if (token) {
      token.key = parseKey(token.value);
    }
    return token;
  }

  private getEscapedPlaceholderKey({ key, quoteChar }: { key: string; quoteChar: string }) {
    return key.replace(new RegExp(escapeRegExp('\\') + quoteChar, 'g'), quoteChar);
  }

  // Decimal, binary, or hex numbers
  private getNumberToken(input: string) {
    return this.getTokenOnFirstMatch({ input, type: tokenTypes.NUMBER, regex: this.NUMBER_REGEX });
  }

  // Punctuation and symbols
  private getOperatorToken(input: string) {
    return this.getTokenOnFirstMatch({ input, type: tokenTypes.OPERATOR, regex: this.OPERATOR_REGEX });
  }

  private getReservedWordToken(input: string, previousToken: IToken) {
    // A reserved word cannot be preceded by a "."
    // this makes it so in "mytable.from", "from" is not considered a reserved word
    if (previousToken && previousToken.value && previousToken.value === '.') {
      return;
    }
    return (
      this.getToplevelReservedToken(input) || this.getNewlineReservedToken(input) || this.getPlainReservedToken(input)
    );
  }

  private getToplevelReservedToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.RESERVED_TOPLEVEL,
      regex: this.RESERVED_TOPLEVEL_REGEX
    });
  }

  private getNewlineReservedToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.RESERVED_NEWLINE,
      regex: this.RESERVED_NEWLINE_REGEX
    });
  }

  private getPlainReservedToken(input: string) {
    return this.getTokenOnFirstMatch({
      input,
      type: tokenTypes.RESERVED,
      regex: this.RESERVED_PLAIN_REGEX
    });
  }

  private getWordToken(input: string) {
    return this.getTokenOnFirstMatch({ input, type: tokenTypes.WORD, regex: this.WORD_REGEX });
  }

  private getTokenOnFirstMatch({ input, type, regex }: { input: string; type: string; regex: boolean | RegExp }) {
    if (typeof regex === 'boolean') {
      return null;
    } else {
      const matches = input.match(regex);

      if (matches) {
        return { type, value: matches[1], key: null as string };
      }
    }
  }
}
