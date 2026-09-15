import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';

export interface ReasonDialogProps {
  readonly title: string;
  /** What confirming does, in one or two sentences. */
  readonly message: string;
  readonly confirmLabel: string;
  readonly color: string;
  readonly onCancel: () => void;
  /** The trimmed reason, or undefined when none was typed. */
  readonly onConfirm: (reason: string | undefined) => void;
}

/** A confirmation with an optional reason, for a press that settles a whole row at once. */
export function ReasonDialog({
  title,
  message,
  confirmLabel,
  color,
  onCancel,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <Modal opened centered onClose={onCancel} title={title}>
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Textarea
          label="Reason"
          description="Optional."
          autosize
          minRows={2}
          maxRows={6}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            color={color}
            onClick={() => onConfirm(reason.trim() === '' ? undefined : reason.trim())}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
