// Network Popover component - share/join local network

import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@moonwitness/ui/components/popover";
import { Button } from "@moonwitness/ui/components/button";
import { Input } from "@moonwitness/ui/components/input";
import { UsersIcon as Share2Icon, SignalIcon as WifiIcon, SignalOffIcon as WifiOffIcon, UsersIcon, UserIcon as UserPlusIcon, CloseIcon as XIcon, DocumentIcon as CopyIcon, CheckIcon, RefreshIcon as Loader2Icon, GlobeIcon, LockIcon, UserIcon, CloseIcon as MinusIcon } from "@moonwitness/ui/icons";
import type { Net } from "../types";
import { api } from "../api";
import { tr } from "../lib/i18n";

interface NetworkPopoverProps {
  net: Net | null;
  onRefresh: () => void;
}

export function NetworkPopover({ net, onRefresh }: NetworkPopoverProps) {
  const [sharing, setSharing] = useState(false);
  const [joinAddress, setJoinAddress] = useState("");
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  const startSharing = async () => {
    try {
      await api("POST", "/network", { action: "share" });
      onRefresh();
    } catch (e) {
      console.error("Failed to start sharing:", e);
    }
  };

  const stopSharing = async () => {
    try {
      await api("POST", "/network", { action: "unshare" });
      onRefresh();
    } catch (e) {
      console.error("Failed to stop sharing:", e);
    }
  };

  const joinNetwork = async () => {
    if (!joinAddress.trim()) return;
    setJoining(true);
    try {
      await api("POST", "/network", { action: "join", address: joinAddress.trim() });
      onRefresh();
      setJoinAddress("");
    } catch (e) {
      console.error("Failed to join:", e);
    } finally {
      setJoining(false);
    }
  };

  const leaveNetwork = async () => {
    try {
      await api("POST", "/network", { action: "leave" });
      onRefresh();
    } catch (e) {
      console.error("Failed to leave:", e);
    }
  };

  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon">
          {net?.state === "sharing" ? <WifiIcon className="h-5 w-5 text-green-500" /> : <WifiOffIcon className="h-5 w-5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="network-popover">
          {net?.state === "private" && (
            <div className="network-section">
              <h4>{tr("Share this board")}</h4>
              <p className="network-desc">{tr("Allow others on your local network to join this board")}</p>
              <Button onClick={startSharing} className="w-full">
                <Share2Icon className="h-4 w-4 mr-2" />
                {tr("Start sharing")}
              </Button>
            </div>
          )}

          {net?.state === "sharing" && (
            <div className="network-section">
              <h4>{tr("Sharing active")}</h4>
              <p className="network-desc">{tr("Others can join using one of these addresses:")}</p>
              <div className="address-list">
                {net.addresses?.map((addr, i) => (
                  <div key={i} className="address-item">
                    <code>{addr}</code>
                    <Button variant="ghost" size="icon" onClick={() => copyAddress(addr)}>
                      {copied ? <CheckIcon className="h-4 w-4 text-green-500" /> : <CopyIcon className="h-4 w-4" />}
                    </Button>
                  </div>
                ))}
              </div>
              <p className="network-hint">{tr("Guests:")} {net.guests?.length || 0}</p>
              {net.guests && net.guests.length > 0 && (
                <ul className="guest-list">
                  {net.guests.map((g, i) => (
                    <li key={i} className="guest-item">
                      <UserIcon className="h-4 w-4 mr-2" />
                      <span>{g.name || tr("Anonymous")}</span>
                      <code className="ml-2 text-xs">{g.address}</code>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="destructive" onClick={stopSharing} className="w-full mt-2">
                <WifiOffIcon className="h-4 w-4 mr-2" />
                {tr("Stop sharing")}
              </Button>
            </div>
          )}

          {net?.state === "joined" && (
            <div className="network-section">
              <h4>{tr("Joined board")}</h4>
              <p className="network-desc">{tr("Connected to")} <code>{net.host}</code></p>
              <p className="network-hint">{tr("Guests:")} {net.guests?.length || 0}</p>
              {net.guests && net.guests.length > 0 && (
                <ul className="guest-list">
                  {net.guests.map((g, i) => (
                    <li key={i} className="guest-item">
                      <UserIcon className="h-4 w-4 mr-2" />
                      <span>{g.name || tr("Anonymous")}</span>
                      <code className="ml-2 text-xs">{g.address}</code>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="destructive" onClick={leaveNetwork} className="w-full mt-2">
                              <UserIcon className="h-4 w-4 mr-2" />
                              <MinusIcon className="h-4 w-4 ml-1" />
                {tr("Leave board")}
              </Button>
            </div>
          )}

          <div className="network-divider" />

          <div className="network-section">
            <h4>{tr("Join a board")}</h4>
            <p className="network-desc">{tr("Enter the host address to join a shared board")}</p>
            <div className="join-form">
              <Input
                type="text"
                value={joinAddress}
                onChange={(e) => setJoinAddress(e.target.value)}
                placeholder={tr("http://192.168.1.100:4242")}
                className="join-input"
                onKeyDown={(e) => e.key === "Enter" && joinNetwork()}
              />
              <Button onClick={joinNetwork} disabled={joining || !joinAddress.trim()}>
                {joining ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <UserPlusIcon className="h-4 w-4" />}
                {joining ? tr("Joining...") : tr("Join")}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

