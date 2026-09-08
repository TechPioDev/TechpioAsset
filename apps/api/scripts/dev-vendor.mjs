/**
 * A supplier account on the local database, for walking the vendor flow by hand.
 *
 * Idempotent: run it as often as you like. Creates the vendor, the user, the
 * VENDOR role link and a laptop spec template, and matches production's
 * publish-immediately policy so what you see here is what a supplier sees there.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '../../.env') });
const prisma = new PrismaClient();

// The seeded demo tenant, found by one of its users rather than by being first:
// several companies exist locally and only this one has known credentials.
const template = await prisma.user.findFirstOrThrow({
  where: { email: 'employee@techpioasset.dev' },
  select: { passwordHash: true, companyId: true },
});
const companyId = template.companyId;
const company = await prisma.company.findUniqueOrThrow({
  where: { id: companyId },
  select: { id: true, name: true },
});

const vendor =
  (await prisma.vendor.findFirst({ where: { companyId, code: 'DEVSUP' } })) ??
  (await prisma.vendor.create({
    data: {
      companyId,
      code: 'DEVSUP',
      name: 'Devendra Supplies',
      contactName: 'Devendra Rao',
      contactEmail: 'sales@devendra.example',
      contactPhone: '+91 98765 43210',
      isActive: true,
    },
  }));

const role = await prisma.role.findFirstOrThrow({
  where: { companyId, key: 'VENDOR', deletedAt: null },
});

const email = 'supplier@techpioasset.dev';
let user = await prisma.user.findFirst({ where: { companyId, email } });
if (!user) {
  user = await prisma.user.create({
    data: {
      companyId,
      email,
      passwordHash: template.passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      vendorId: vendor.id,
      roles: { create: { roleId: role.id } },
    },
  });
} else {
  await prisma.user.update({ where: { id: user.id }, data: { vendorId: vendor.id } });
  const linked = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
  if (!linked) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
}

// The publishing policy is deliberately NOT touched here. The integration
// suite runs against this same database and several of its tests assert the
// default, so flipping it from a setup script breaks them from a distance.
// Change it in Settings > Organisation, or with --publish-now below.
if (process.argv.includes('--publish-now')) {
  await prisma.company.update({
    where: { id: companyId },
    data: { vendorOfferPolicy: 'PUBLISH_IMMEDIATELY' },
  });
}

// A category of its own, never one of the seeded ones. Required spec fields
// added to a shared category make every other suite's offers fail the
// required-spec gate from a distance - which is exactly what happened once.
const category =
  (await prisma.category.findFirst({ where: { companyId, key: 'supplier-demo' } })) ??
  (await prisma.category.create({
    data: { companyId, key: 'supplier-demo', name: 'Supplier demo kit' },
  }));

const FIELDS = [
  { key: 'ram_gb', label: 'RAM', dataType: 'NUMBER', unit: 'GB', intent: 'AT_LEAST', isRequired: true, sortOrder: 1 },
  { key: 'storage_gb', label: 'Storage', dataType: 'NUMBER', unit: 'GB', intent: 'AT_LEAST', isRequired: true, sortOrder: 2 },
  { key: 'weight_kg', label: 'Weight', dataType: 'NUMBER', unit: 'kg', intent: 'AT_MOST', isRequired: false, sortOrder: 3 },
  { key: 'os', label: 'Operating system', dataType: 'TEXT', isRequired: false, sortOrder: 4 },
];
for (const f of FIELDS) {
  const existing = await prisma.categorySpecField.findFirst({
    where: { companyId, categoryId: category.id, key: f.key, subcategoryId: null },
  });
  if (!existing) {
    await prisma.categorySpecField.create({
      data: { companyId, categoryId: category.id, subcategoryId: null, ...f },
    });
  }
}

console.log(JSON.stringify({
  company: company.name,
  vendor: vendor.name,
  login: email,
  password: 'TechpioDemo!2026',
  category: category.name,
  policy: process.argv.includes('--publish-now') ? 'PUBLISH_IMMEDIATELY' : 'unchanged',
}, null, 2));
await prisma.$disconnect();
