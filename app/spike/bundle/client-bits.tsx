"use client";
import { Command } from "cmdk";
import { motion } from "motion/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryState, parseAsString } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1) });

function Inner() {
  const { register } = useForm({ resolver: zodResolver(schema) });
  const [q] = useQueryState("q", parseAsString);
  return (
    <motion.div animate={{ opacity: 1 }}>
      <input {...register("name")} />
      <Command>
        <Command.Input value={q ?? ""} />
      </Command>
    </motion.div>
  );
}

export function ClientBits() {
  return (
    <NuqsAdapter>
      <Inner />
    </NuqsAdapter>
  );
}
