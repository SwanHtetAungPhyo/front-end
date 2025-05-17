"use client";

import type React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight, Lock, Loader2 } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { toast } from "sonner";
import { verifyEmail } from "@/lib/actions";

const VerificationSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const verificationSchemaDefaultValues: z.infer<typeof VerificationSchema> = {
  email: "",
  code: "",
};

export default function VerifyPage({
                                     searchParams,
                                   }: {
  searchParams: Promise<{
    email: string;
  }>;
}) {
  const { email } = use(searchParams);
  const { push } = useRouter();

  const form = useForm({
    resolver: zodResolver(VerificationSchema),
    defaultValues: {
      ...verificationSchemaDefaultValues,
      email: email || "",
    },
  });

  const isLoading = form.formState.isSubmitting;

  const handleSubmit = async (values: z.infer<typeof VerificationSchema>) => {
    toast.promise(verifyEmail(values), {
      loading: "Verifying...",
      success: () => {
        push("/sign-in");
        return "Account verified successfully";
      },
      error: (err) => err.message || "Failed to verify account. Please try again.",
    });
  };

  const handleResend = async () => {
    toast.promise(
        fetch(`https://civer.up.railway.app/auth/verify-email/${encodeURIComponent(email)}/resend`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ email }),
        }),
        {
          loading: "Resending code...",
          success: () => {
            return "Verification code resent successfully";
          },
          error: () => "Failed to resend verification code. Please try again.",
        }
    );
  };

  return (
      <main className="max-w-md mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Verify Your Account</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Enter the 6-digit code sent to <strong>{email}</strong>
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Verification Code</CardTitle>
            <CardDescription>
              We've sent a 6-digit code to {email}
            </CardDescription>
          </CardHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
              <CardContent className="flex justify-center items-center">
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem className="flex flex-col items-center mb-8">
                          <FormLabel>One-Time Password</FormLabel>
                          <FormControl>
                            <InputOTP maxLength={6} {...field}>
                              <InputOTPGroup>
                                <InputOTPSlot className="size-14" index={0} />
                                <InputOTPSlot className="size-14" index={1} />
                                <InputOTPSlot className="size-14" index={2} />
                                <InputOTPSlot className="size-14" index={3} />
                                <InputOTPSlot className="size-14" index={4} />
                                <InputOTPSlot className="size-14" index={5} />
                              </InputOTPGroup>
                            </InputOTP>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                    )}
                />
              </CardContent>

              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                      <Loader2 className="animate-spin" />
                  ) : (
                      <>
                        Verify Account
                        <ArrowRight size={16} className="ml-2" />
                      </>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  Didn't receive a code? Check your spam folder or{" "}
                  <button
                      type="button"
                      onClick={handleResend}
                      className={cn(
                          buttonVariants({ variant: "link" }),
                          "inline px-1 py-0"
                      )}
                      disabled={isLoading}
                  >
                    resend code
                  </button>
                </p>
              </CardFooter>
            </form>
          </Form>
        </Card>

        <div className="mt-4 flex items-center gap-2 justify-center text-sm text-muted-foreground">
          <Lock size={16} />
          Secure verification with end-to-end encryption
        </div>
      </main>
  );
}