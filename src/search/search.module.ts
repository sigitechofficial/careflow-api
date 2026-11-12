import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocumentTextIndexer } from './document-text-indexer.service';

/**
 * "Find anything" across records, and the reader that makes documents searchable by their text. Other modules'
 * services are looked up at request time (ModuleRef).
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService, DocumentTextIndexer],
  exports: [DocumentTextIndexer],
})
export class SearchModule {}
