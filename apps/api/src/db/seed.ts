import { db, pool } from './client.js';
import { phases, taskCollections, taskDependencies, tasks } from './schema/index.js';
await db.transaction(async (tx) => {
  await tx.delete(taskDependencies);
  await tx.delete(tasks);
  await tx.delete(phases);
  await tx.delete(taskCollections);
  const collections = await tx
    .insert(taskCollections)
    .values([
      {
        name: 'Personal Administration',
        description: 'Life admin and recurring paperwork',
        structure: 'FLAT',
        status: 'ACTIVE',
        position: 0,
      },
      {
        name: 'Home Maintenance',
        description: 'Repairs and seasonal upkeep',
        structure: 'FLAT',
        status: 'ACTIVE',
        position: 1,
      },
      {
        name: 'Website Redesign',
        description: 'A focused redesign from discovery through launch',
        structure: 'PHASED',
        status: 'ACTIVE',
        startDate: '2026-08-17',
        targetEndDate: '2026-10-30',
        position: 2,
      },
      {
        name: 'Replace Server Storage',
        description: 'Plan and execute a safe storage migration',
        structure: 'PHASED',
        status: 'PAUSED',
        position: 3,
      },
    ])
    .returning();
  const website = collections.find((c) => c.name === 'Website Redesign')!;
  const personal = collections.find((c) => c.name === 'Personal Administration')!;
  const phaseDates = ['2026-08-17', '2026-08-31', '2026-09-07', '2026-09-21', '2026-10-26'];
  const websitePhases = await tx
    .insert(phases)
    .values(
      ['Discovery', 'Planning', 'Design', 'Development', 'Launch'].map((name, position) => ({
        collectionId: website.id,
        name,
        position,
        startDate: phaseDates[position],
      })),
    )
    .returning();
  const discovery = websitePhases[0]!;
  const planning = websitePhases[1]!;
  const created = await tx
    .insert(tasks)
    .values([
      {
        collectionId: website.id,
        phaseId: discovery.id,
        name: 'Stakeholder interviews',
        urgency: 'HIGH',
        dueDate: '2026-08-20',
        completedAt: new Date('2026-08-20T10:00:00Z'),
        position: 0,
      },
      {
        collectionId: website.id,
        phaseId: discovery.id,
        name: 'Current site audit',
        urgency: 'MEDIUM',
        completedAt: new Date('2026-08-22T10:00:00Z'),
        position: 1,
      },
      {
        collectionId: website.id,
        phaseId: planning.id,
        name: 'Define information architecture',
        urgency: 'HIGH',
        dueDate: '2026-08-31',
        position: 0,
      },
      {
        collectionId: website.id,
        phaseId: planning.id,
        name: 'Content strategy',
        urgency: 'MEDIUM',
        dueDate: '2026-09-02',
        completedAt: new Date('2026-09-02T12:00:00Z'),
        position: 1,
      },
      {
        collectionId: website.id,
        phaseId: planning.id,
        name: 'Sitemap',
        urgency: 'MEDIUM',
        dueDate: '2026-09-03',
        waitingReason: 'Waiting for navigation approval',
        position: 2,
      },
      {
        collectionId: website.id,
        name: 'Confirm analytics retention',
        urgency: 'LOW',
        position: 0,
      },
      {
        collectionId: personal.id,
        name: 'Renew home insurance',
        urgency: 'CRITICAL',
        dueDate: '2026-09-15',
        position: 0,
      },
    ])
    .returning();
  const architecture = created.find((t) => t.name === 'Define information architecture')!;
  const sitemap = created.find((t) => t.name === 'Sitemap')!;
  await tx
    .insert(taskDependencies)
    .values({ taskId: sitemap.id, dependsOnTaskId: architecture.id });
});
await pool.end();
console.log('Waymark development data seeded');
