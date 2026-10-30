"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
const sizes = ["xs", "sm", "default", "lg"] as const;

const fruits = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "blueberry", label: "Blueberry" },
];
const vegetables = [
  { value: "carrot", label: "Carrot" },
  { value: "potato", label: "Potato" },
];
const items = [...fruits, ...vegetables];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function KitchenSink() {
  const [clicks, setClicks] = useState(0);
  const [food, setFood] = useState<string | null>("banana");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      <Section title="Button: variants">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} onClick={() => setClicks((n) => n + 1)}>
              {variant}
            </Button>
          ))}
          <Button disabled>disabled</Button>
        </div>
        <p className="text-sm">Clicks (client state works): {clicks}</p>
      </Section>

      <Section title="Button: sizes">
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Button: render prop (replaces asChild)">
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<a href="/api/hello" />}>
            Link to /api/hello
          </Button>
        </div>
      </Section>

      <Section title="Select (controlled)">
        <Select items={items} value={food} onValueChange={setFood}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Pick food" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Fruits</SelectLabel>
              {fruits.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Vegetables</SelectLabel>
              {vegetables.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm">Selected value: {food ?? "none"}</p>
      </Section>

      <Section title="Dialog">
        <div>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Are you sure?</DialogTitle>
                <DialogDescription>
                  Tests focus trap, Escape, outside click, portal and animations.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <DialogClose render={<Button onClick={() => setConfirmed(true)} />}>
                  Confirm
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <p className="text-sm">Confirmed: {String(confirmed)}</p>
      </Section>

      <Section title="Select inside Dialog (nested popups)">
        <div>
          <Dialog>
            <DialogTrigger render={<Button variant="secondary" />}>
              Dialog with select
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Choose</DialogTitle>
                <DialogDescription>The select popup must layer above the dialog.</DialogDescription>
              </DialogHeader>
              <Select items={items} defaultValue="apple">
                <SelectTrigger className="w-full max-w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent /* alignItemWithTrigger={false} */>
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </DialogContent>
          </Dialog>
        </div>
      </Section>
    </>
  );
}
