// lib/actions.ts
"use server";

import { cookies } from "next/headers";
import { Gig, PrismaClient, User } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  CreateGigFormSchema,
  EditGigFormSchema,
  SignInFormSchema,
} from "./schemas";
import { revalidatePath } from "next/cache";

const prisma = new PrismaClient();

// const resend = new Resend(process.env.RESEND_API_KEY);

export const me = async (): Promise<User | null> => {
  const token = (await cookies()).get("token")?.value;

  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);

    if (
      typeof decoded !== "object" ||
      !("id" in decoded) ||
      typeof decoded.id !== "string"
    ) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    return user ?? null;
  } catch {
    return null;
  }
};

export const getGigsByUserId = async (userId: string) => {
  const gigs = await prisma.gig.findMany({
    where: {
      sellerId: userId,
    },
    include: {
      images: true,
      category: true,
      tags: true,
      packages: {
        include: {
          orders: true,
        },
      },
    },
  });

  return gigs;
};



export async function logIn(values: z.infer<typeof SignInFormSchema>) {
  try {
    const response = await fetch("https://civer.up.railway.app/auth/sign-in", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include if cookies or sessions are needed
      body: JSON.stringify({
        email: values.email,
        password: values.password,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to sign in");
    }

    const data: {
      message: string;
      metaData?: {
        username: string;
        email: string;
        userId: string;
        accessToken: string;
      };
    } = await response.json();

    return data;
  } catch (error) {
    throw error instanceof Error
        ? error
        : new Error("An unexpected error occurred");
  }
}
export const signUp = async (values: any) => {
  const response = await fetch('https://civer.up.railway.app/auth/sign-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(values),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to sign up' }));
    console.error('API Error:', response.status, errorData);
    throw new Error(errorData.message || `Failed to sign up (${response.status})`);
  }

  return response.json();
};


export async function verifyEmail(values: { email: string; code: string }) {
  try {
    const response = await fetch("https://civer.up.railway.app/auth/verify-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        email: values.email,
        code: values.code,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to verify email");
    }

    return await response.json();
  } catch (error) {
    throw error instanceof Error
        ? error
        : new Error("An unexpected error occurred");
  }
}

export const createGig = async (
  values: z.infer<typeof CreateGigFormSchema>
) => {
  const { title, description, categoryId, tags, images, packages } = values;

  const user = await me();

  if (!user) {
    throw new Error("User not authenticated");
  }

  let gig: Gig | null = null;

  await prisma.$transaction(async (tx) => {
    // 1. First create the gig with its direct relations (no features yet)
    gig = await tx.gig.create({
      data: {
        title,
        description,
        categoryId,
        sellerId: user.id,
        tags: {
          connectOrCreate: tags.map((tag) => ({
            where: { label: tag.label },
            create: { label: tag.label },
          })),
        },
        images: {
          createMany: {
            data: images.map((image) => ({
              url: image.url,
              isPrimary: image.isPrimary,
              sortOrder: image.sortOrder,
            })),
          },
        },
      },
    });

    // 2. Create each package separately
    for (const pack of packages) {
      // Create the package
      const createdPackage = await tx.gigPackage.create({
        data: {
          title: pack.title,
          description: pack.description,
          price: pack.price,
          deliveryTime: pack.deliveryTime,
          revisions: pack.revisions,
          gigId: gig.id, // Connect to the gig
        },
      });

      // 3. Create the features for this package
      if (pack.features && pack.features.length > 0) {
        await tx.gigPackageFeature.createMany({
          data: pack.features.map((feature) => ({
            title: feature.title,
            included: feature.included,
            gigPackageId: createdPackage.id, // Connect to the package
          })),
        });
      }
    }

    return gig;
  });

  return gig!;
};

export const getGigTags = async () => {
  const tags = await prisma.gigTag.findMany({
    orderBy: {
      label: "asc",
    },
  });

  return tags;
};

export const getCategories = async () => {
  const categories = await prisma.category.findMany({});

  return categories;
};

export const deleteGig = async (gigId: string) => {
  const user = await me();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { seller: true },
  });

  if (!gig || gig.sellerId !== user.id) {
    throw new Error("Gig not found or you are not the owner");
  }
  await prisma.gig.delete({
    where: { id: gigId },
  });

  revalidatePath("/dashboard/gigs");
};

export const getGigById = async (gigId: string) => {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: {
      images: true,
      category: true,
      tags: true,
      packages: {
        include: {
          features: true,
          orders: true,
        },
      },
    },
  });

  return gig;
};
export const updateGig = async (values: z.infer<typeof EditGigFormSchema>) => {
  const {
    id: gigId,
    title,
    description,
    categoryId,
    tags,
    images,
    packages,
  } = values;

  const user = await me();

  if (!user) {
    throw new Error("User not authenticated");
  }

  // First check if the gig exists and belongs to the user
  const existingGig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: {
      tags: true,
      images: true,
      packages: {
        include: {
          features: true,
        },
      },
    },
  });

  if (!existingGig) {
    throw new Error("Gig not found");
  }

  if (existingGig.sellerId !== user.id) {
    throw new Error("Unauthorized to update this gig");
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update the gig's basic properties
    await tx.gig.update({
      where: { id: gigId },
      data: {
        title,
        description,
        categoryId,
      },
    });

    // 2. Handle tags
    // First disconnect all existing tags
    await tx.gig.update({
      where: { id: gigId },
      data: {
        tags: {
          disconnect: existingGig.tags.map((tag) => ({ id: tag.id })),
        },
      },
    });

    // Then connect or create new tags
    for (const tag of tags) {
      if (tag.id) {
        // Connect existing tag
        await tx.gig.update({
          where: { id: gigId },
          data: {
            tags: {
              connect: { id: tag.id },
            },
          },
        });
      } else {
        // Create new tag or connect existing one by label
        await tx.gig.update({
          where: { id: gigId },
          data: {
            tags: {
              connectOrCreate: {
                where: { label: tag.label },
                create: { label: tag.label },
              },
            },
          },
        });
      }
    }

    // 3. Handle images
    // First identify which images to keep, update, or delete
    const existingImageIds = existingGig.images.map((img) => img.id);
    const keepImageIds = images
      .filter((img) => img.id)
      .map((img) => img.id as string);
    const deleteImageIds = existingImageIds.filter(
      (id) => !keepImageIds.includes(id)
    );

    // Delete images that are no longer in the form
    if (deleteImageIds.length > 0) {
      await tx.gigImage.deleteMany({
        where: { id: { in: deleteImageIds } },
      });
    }

    // Update existing images and create new ones
    for (const image of images) {
      if (image.id) {
        // Update existing image
        await tx.gigImage.update({
          where: { id: image.id },
          data: {
            url: image.url,
            isPrimary: image.isPrimary ?? false,
            sortOrder: image.sortOrder,
          },
        });
      } else {
        // Create new image
        await tx.gigImage.create({
          data: {
            url: image.url,
            isPrimary: image.isPrimary ?? false,
            sortOrder: image.sortOrder,
            gigId,
          },
        });
      }
    }

    // 4. Handle packages
    // First identify which packages to keep, update, or delete
    const existingPackageIds = existingGig.packages.map((pkg) => pkg.id);
    const keepPackageIds = packages
      .filter((pkg) => pkg.id)
      .map((pkg) => pkg.id as string);
    const deletePackageIds = existingPackageIds.filter(
      (id) => !keepPackageIds.includes(id)
    );

    // Delete packages that are no longer in the form
    for (const packageId of deletePackageIds) {
      // First delete all features for this package
      await tx.gigPackageFeature.deleteMany({
        where: { gigPackageId: packageId },
      });

      // Then delete the package
      await tx.gigPackage.delete({
        where: { id: packageId },
      });
    }

    // Update existing packages and create new ones
    for (const pack of packages) {
      if (pack.id) {
        // Update existing package
        await tx.gigPackage.update({
          where: { id: pack.id },
          data: {
            title: pack.title,
            description: pack.description,
            price: pack.price,
            deliveryTime: pack.deliveryTime,
            revisions: pack.revisions || undefined,
          },
        });

        // Handle features for this package
        // Get existing features
        const existingFeatures = await tx.gigPackageFeature.findMany({
          where: { gigPackageId: pack.id },
        });

        // Identify which features to keep, update, or delete
        const existingFeatureIds = existingFeatures.map((feat) => feat.id);
        const keepFeatureIds = pack.features
          .filter((feat) => feat.id)
          .map((feat) => feat.id as string);
        const deleteFeatureIds = existingFeatureIds.filter(
          (id) => !keepFeatureIds.includes(id)
        );

        // Delete features that are no longer in the form
        if (deleteFeatureIds.length > 0) {
          await tx.gigPackageFeature.deleteMany({
            where: { id: { in: deleteFeatureIds } },
          });
        }

        // Update existing features and create new ones
        for (const feature of pack.features) {
          if (feature.id) {
            // Update existing feature
            await tx.gigPackageFeature.update({
              where: { id: feature.id },
              data: {
                title: feature.title,
                included: feature.included ?? true,
              },
            });
          } else {
            // Create new feature
            await tx.gigPackageFeature.create({
              data: {
                title: feature.title,
                included: feature.included ?? true,
                gigPackageId: pack.id,
              },
            });
          }
        }
      } else {
        // Create new package
        const newPackage = await tx.gigPackage.create({
          data: {
            title: pack.title,
            description: pack.description,
            price: pack.price,
            deliveryTime: pack.deliveryTime,
            revisions: pack.revisions || undefined,
            gigId,
          },
        });

        // Create features for this new package
        if (pack.features && pack.features.length > 0) {
          await tx.gigPackageFeature.createMany({
            data: pack.features.map((feature) => ({
              title: feature.title,
              included: feature.included ?? true,
              gigPackageId: newPackage.id,
            })),
          });
        }
      }
    }
  });

  // Fetch the updated gig with all relations
  const refreshedGig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: {
      category: true,
      tags: true,
      images: true,
      packages: {
        include: {
          features: true,
        },
      },
    },
  });

  return refreshedGig!;
};

export const getUserBadges = async () => {
  return prisma.badge.findMany({
    include: {
      userBadges: true,
    },
  });
};
