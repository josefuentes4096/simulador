// Small main-process i18n. The renderer ships its own i18next bundle; we
// can't share it because main runs in Node before any window exists. This
// module covers only the strings the main process owns: native menu labels,
// validation errors thrown when reading a file off disk.
//
// Adding a new language: append a new key to STRINGS with the same shape.
// The renderer's catalog and this dict are the two places that need a new
// locale, by design — neither is dynamically loaded from the other side.

export type MainLocale = 'es' | 'en' | 'pt';

interface Strings {
  menu: {
    file: string;
    new_: string;
    open: string;
    openRecent: string;
    save: string;
    saveAs: string;
    exportAs: string;
    print: string;
    close: string;
    exit: string;
    clearRecent: string;
    empty: string;
    edit: string;
    undo: string;
    redo: string;
    delete: string;
    preferences: string;
    view: string;
    toggleSidebar: string;
    toggleChart: string;
    help: string;
    about: string;
    documentation: string;
    exportPng: string;
    exportPdf: string;
    exportSvg: string;
    exportCsv: string;
    exportJson: string;
    exportDrawio: string;
    exportCpp: string;
    exportJava: string;
    exportGo: string;
  };
  errors: {
    invalidJson: string;
    invalidStructure: string;
    unsupportedSchema: string;
    missingMetadata: string;
    missingBehavior: string;
    missingDiagram: string;
  };
}

const STRINGS: Record<MainLocale, Strings> = {
  es: {
    menu: {
      file: 'Archivo',
      new_: 'Nuevo',
      open: 'Abrir…',
      openRecent: 'Abrir reciente',
      save: 'Guardar',
      saveAs: 'Guardar como…',
      exportAs: 'Exportar como',
      print: 'Imprimir…',
      close: 'Cerrar',
      exit: 'Salir',
      clearRecent: 'Limpiar recientes',
      empty: '(vacío)',
      edit: 'Edición',
      undo: 'Deshacer',
      redo: 'Rehacer',
      delete: 'Eliminar',
      preferences: 'Preferencias…',
      view: 'Ver',
      toggleSidebar: 'Alternar panel',
      toggleChart: 'Alternar gráficos',
      help: 'Ayuda',
      about: 'Acerca de',
      documentation: 'Documentación',
      exportPng: 'Diagrama PNG',
      exportPdf: 'Documento PDF',
      exportSvg: 'Diagrama SVG',
      exportCsv: 'Traza CSV',
      exportJson: 'Resultados JSON',
      exportDrawio: 'XML draw.io',
      exportCpp: 'Código C++',
      exportJava: 'Código Java',
      exportGo: 'Código Go',
    },
    errors: {
      invalidJson: 'No se pudo parsear el archivo (JSON inválido): {detail}',
      invalidStructure: '[{file}] estructura inválida: se esperaba un objeto en la raíz',
      unsupportedSchema:
        '[{file}] schemaVersion no soportado ({version}); este simulador lee solo schemaVersion {expected}',
      missingMetadata: '[{file}] falta el bloque "metadata"',
      missingBehavior: '[{file}] falta el bloque "behavior"',
      missingDiagram: '[{file}] falta el bloque "diagram"',
    },
  },
  en: {
    menu: {
      file: 'File',
      new_: 'New',
      open: 'Open…',
      openRecent: 'Open Recent',
      save: 'Save',
      saveAs: 'Save As…',
      exportAs: 'Export As',
      print: 'Print…',
      close: 'Close',
      exit: 'Exit',
      clearRecent: 'Clear Recent',
      empty: '(empty)',
      edit: 'Edit',
      undo: 'Undo',
      redo: 'Redo',
      delete: 'Delete',
      preferences: 'Preferences…',
      view: 'View',
      toggleSidebar: 'Toggle Sidebar',
      toggleChart: 'Toggle Chart',
      help: 'Help',
      about: 'About',
      documentation: 'Documentation',
      exportPng: 'PNG diagram',
      exportPdf: 'PDF document',
      exportSvg: 'SVG diagram',
      exportCsv: 'CSV trace',
      exportJson: 'JSON results',
      exportDrawio: 'draw.io XML',
      exportCpp: 'C++ source',
      exportJava: 'Java source',
      exportGo: 'Go source',
    },
    errors: {
      invalidJson: 'Could not parse the file (invalid JSON): {detail}',
      invalidStructure: '[{file}] invalid structure: expected an object at the root',
      unsupportedSchema:
        '[{file}] schemaVersion not supported ({version}); this simulator only reads schemaVersion {expected}',
      missingMetadata: '[{file}] "metadata" block missing',
      missingBehavior: '[{file}] "behavior" block missing',
      missingDiagram: '[{file}] "diagram" block missing',
    },
  },
  pt: {
    menu: {
      file: 'Arquivo',
      new_: 'Novo',
      open: 'Abrir…',
      openRecent: 'Abrir recente',
      save: 'Salvar',
      saveAs: 'Salvar como…',
      exportAs: 'Exportar como',
      print: 'Imprimir…',
      close: 'Fechar',
      exit: 'Sair',
      clearRecent: 'Limpar recentes',
      empty: '(vazio)',
      edit: 'Editar',
      undo: 'Desfazer',
      redo: 'Refazer',
      delete: 'Excluir',
      preferences: 'Preferências…',
      view: 'Ver',
      toggleSidebar: 'Alternar painel',
      toggleChart: 'Alternar gráficos',
      help: 'Ajuda',
      about: 'Sobre',
      documentation: 'Documentação',
      exportPng: 'Diagrama PNG',
      exportPdf: 'Documento PDF',
      exportSvg: 'Diagrama SVG',
      exportCsv: 'Traço CSV',
      exportJson: 'Resultados JSON',
      exportDrawio: 'XML draw.io',
      exportCpp: 'Código C++',
      exportJava: 'Código Java',
      exportGo: 'Código Go',
    },
    errors: {
      invalidJson: 'Não foi possível parsear o arquivo (JSON inválido): {detail}',
      invalidStructure: '[{file}] estrutura inválida: esperado um objeto na raiz',
      unsupportedSchema:
        '[{file}] schemaVersion não suportado ({version}); este simulador lê apenas schemaVersion {expected}',
      missingMetadata: '[{file}] bloco "metadata" ausente',
      missingBehavior: '[{file}] bloco "behavior" ausente',
      missingDiagram: '[{file}] bloco "diagram" ausente',
    },
  },
};

let current: MainLocale = 'es';

export function setMainLocale(loc: MainLocale): void {
  if (loc in STRINGS) current = loc;
}
export function getMainLocale(): MainLocale {
  return current;
}
export function strings(): Strings {
  return STRINGS[current];
}

// Substitutes {key} placeholders. Falls back to the source key when missing.
export function tFormat(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
