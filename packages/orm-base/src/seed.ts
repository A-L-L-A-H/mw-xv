export const seedVersion = '1.0.0';
export const dependencies = ['orm-base'];

export async function seed(ctx: { db: any }) {
  // Base seed reference data if needed
  return { inserted: 0, updated: 0, skipped: 0 };
}

export const manifest = {
  seedVersion,
  dependencies,
  seed,
};
