export function buildPaginationMeta(params: {
  page: number;
  limit: number;
  total: number;
}) {
  const { page, limit, total } = params;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

