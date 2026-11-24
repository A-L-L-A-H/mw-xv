'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { formatMinorAmount } from '@/lib/format-money';
import { scopedQueryKey } from '@/lib/query-scope';

interface CrmOpportunityRecord {
  id: number;
  name: string;
  expected_revenue_minor?: number;
  probability?: number;
  stage_id?: number;
  partner_id?: number;
  currency?: string;
  deadline?: string;
  won_date?: string;
}

interface SaleOrderRecord {
  id: number;
  name: string;
  total_amount_minor?: number;
  state_id?: number;
  opportunity_id?: number;
  partner_id?: number;
  confirm_date?: string;
}

interface SubscriptionRecord {
  id: number;
  name: string;
  amount_minor?: number;
  state: string;
  plan_id?: number;
  sale_order_id?: number;
  partner_id?: number;
  start_date?: string;
  next_invoice_date?: string;
}

export function CommercialPage() {
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<number | null>(null);

  const opportunitiesQuery = useQuery({
    queryKey: scopedQueryKey(['crm', 'opportunities']),
    queryFn: async () => {
      const res = await client
        .model<CrmOpportunityRecord>('crm.opportunity')
        .searchRead({ limit: 25 });
      return res.records;
    },
  });

  const ordersQuery = useQuery({
    queryKey: scopedQueryKey(['sales', 'orders']),
    queryFn: async () => {
      const res = await client.model<SaleOrderRecord>('sale.order').searchRead({ limit: 25 });
      return res.records;
    },
  });

  const subscriptionsQuery = useQuery({
    queryKey: scopedQueryKey(['subscription', 'subscriptions']),
    queryFn: async () => {
      const res = await client
        .model<SubscriptionRecord>('subscription.subscription')
        .searchRead({ limit: 25 });
      return res.records;
    },
  });

  const convertToOrderMutation = useMutation({
    mutationFn: async (opportunityId: number) => {
      setActingId(opportunityId);
      return client.request<{ success: boolean; data: SaleOrderRecord }>(
        `/api/sales/opportunities/${opportunityId}/convert-to-order`,
        { method: 'POST' }
      );
    },
    onSuccess: (res) => {
      toast.success(`Converted to Sale Order ${res.data.name}`);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(['sales', 'orders']) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(['crm', 'opportunities']) });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Conversion failed');
    },
    onSettled: () => setActingId(null),
  });

  const confirmOrderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      setActingId(orderId);
      return client.request<{ success: boolean; data: SaleOrderRecord }>(
        `/api/sales/orders/${orderId}/confirm`,
        { method: 'POST' }
      );
    },
    onSuccess: (res) => {
      toast.success(`Order ${res.data.name} confirmed`);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(['sales', 'orders']) });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Confirmation failed');
    },
    onSettled: () => setActingId(null),
  });

  const createSubscriptionMutation = useMutation({
    mutationFn: async (orderId: number) => {
      setActingId(orderId);
      return client.request<{ success: boolean; data: SubscriptionRecord }>(
        `/api/subscriptions/from-order/${orderId}`,
        { method: 'POST' }
      );
    },
    onSuccess: (res) => {
      toast.success(`Subscription ${res.data.name} created`);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['subscription', 'subscriptions']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Subscription creation failed');
    },
    onSettled: () => setActingId(null),
  });

  const activateSubscriptionMutation = useMutation({
    mutationFn: async (subId: number) => {
      setActingId(subId);
      return client.request<{ success: boolean; data: SubscriptionRecord }>(
        `/api/subscriptions/${subId}/activate`,
        { method: 'POST' }
      );
    },
    onSuccess: (res) => {
      toast.success(`Subscription ${res.data.name} activated`);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['subscription', 'subscriptions']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Activation failed');
    },
    onSettled: () => setActingId(null),
  });

  const suspendSubscriptionMutation = useMutation({
    mutationFn: async (subId: number) => {
      setActingId(subId);
      return client.request<{ success: boolean; data: SubscriptionRecord }>(
        `/api/subscriptions/${subId}/suspend`,
        { method: 'POST' }
      );
    },
    onSuccess: (res) => {
      toast.warning(`Subscription ${res.data.name} paused/suspended`);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['subscription', 'subscriptions']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Suspension failed');
    },
    onSettled: () => setActingId(null),
  });

  const opportunities = opportunitiesQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const subscriptions = subscriptionsQuery.data ?? [];

  const activeSubsCount = subscriptions.filter((s) => s.state === 'active').length;
  const confirmedOrdersCount = orders.filter((o) => o.confirm_date).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commercial Pipeline"
        accentTitle="Operations"
        description="End-to-end automation from CRM Opportunities to Confirmed Orders, Active Subscriptions, and Provisioned Infrastructure."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: scopedQueryKey(['crm', 'opportunities']) });
              queryClient.invalidateQueries({ queryKey: scopedQueryKey(['sales', 'orders']) });
              queryClient.invalidateQueries({
                queryKey: scopedQueryKey(['subscription', 'subscriptions']),
              });
            }}
          >
            <RefreshIcon className="mr-1.5 size-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="CRM Opportunities"
          value={String(opportunities.length)}
          detail="Pipeline candidates"
        />
        <MetricTile
          label="Sales Orders"
          value={String(orders.length)}
          detail={`${confirmedOrdersCount} confirmed`}
        />
        <MetricTile
          label="Subscriptions"
          value={String(subscriptions.length)}
          detail={`${activeSubsCount} active billing`}
        />
        <MetricTile label="Infrastructure" value="Cloud & ISP" detail="Provisioning targets" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="CRM Opportunities & Conversion">
          <div className="space-y-3">
            {opportunitiesQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : opportunities.length === 0 ? (
              <p className="font-mono text-sm text-ink-muted">No opportunities recorded.</p>
            ) : (
              opportunities.map((opp) => (
                <div
                  key={opp.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-ink/10 bg-paper-subtle p-3"
                >
                  <div>
                    <p className="font-display text-sm font-semibold text-ink">{opp.name}</p>
                    <p className="font-mono text-xs text-ink-muted">
                      {formatMinorAmount(opp.expected_revenue_minor, opp.currency ?? 'USD')} ·{' '}
                      {opp.probability ?? 0}% win rate
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actingId === opp.id || convertToOrderMutation.isPending}
                    onClick={() => convertToOrderMutation.mutate(opp.id)}
                  >
                    Convert to Order
                  </Button>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Sales Orders & Subscription Binding">
          <div className="space-y-3">
            {ordersQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : orders.length === 0 ? (
              <p className="font-mono text-sm text-ink-muted">No sales orders found.</p>
            ) : (
              orders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-ink/10 bg-paper-subtle p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-display text-sm font-semibold text-ink">{order.name}</p>
                      {order.confirm_date ? (
                        <Badge variant="primary">Confirmed</Badge>
                      ) : (
                        <Badge variant="default">Draft</Badge>
                      )}
                    </div>
                    <p className="font-mono text-xs text-ink-muted">
                      Amount: {formatMinorAmount(order.total_amount_minor)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!order.confirm_date && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actingId === order.id || confirmOrderMutation.isPending}
                        onClick={() => confirmOrderMutation.mutate(order.id)}
                      >
                        Confirm
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === order.id || createSubscriptionMutation.isPending}
                      onClick={() => createSubscriptionMutation.mutate(order.id)}
                    >
                      Bind Sub
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Recurring Subscriptions Lifecycle & Provisioning Link">
        <div className="space-y-3">
          {subscriptionsQuery.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : subscriptions.length === 0 ? (
            <p className="font-mono text-sm text-ink-muted">No recurring subscriptions found.</p>
          ) : (
            subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-ink/10 bg-paper-subtle p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-sm font-semibold text-ink">{sub.name}</p>
                    <Badge
                      variant={
                        sub.state === 'active'
                          ? 'primary'
                          : sub.state === 'paused'
                            ? 'default'
                            : 'destructive'
                      }
                    >
                      {sub.state}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-ink-muted">
                    Amount: {formatMinorAmount(sub.amount_minor)} · Next invoice:{' '}
                    {sub.next_invoice_date ?? 'N/A'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {sub.state !== 'active' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === sub.id || activateSubscriptionMutation.isPending}
                      onClick={() => activateSubscriptionMutation.mutate(sub.id)}
                    >
                      Activate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === sub.id || suspendSubscriptionMutation.isPending}
                      onClick={() => suspendSubscriptionMutation.mutate(sub.id)}
                    >
                      Suspend
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
