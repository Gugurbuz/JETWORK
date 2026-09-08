update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/tab-separated-values',
      'text/html',
      'application/json',
      'application/xml',
      'image/svg+xml',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'image/bmp',
      'image/avif',
      'image/heic',
      'image/heif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]::text[]
where id = 'knowledge-sources';
