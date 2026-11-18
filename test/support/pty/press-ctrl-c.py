"""Run a command on a real pseudo-terminal, press Ctrl-C once <marker> is on screen, print its exit code.

Usage: python3 press-ctrl-c.py <marker> <command> [args...]

A signal death prints as a negative number (-2 for SIGINT). 124 means <marker> never appeared,
125 that the command was still running when the time ran out (it is killed).
"""
import os
import pty
import select
import sys
import time

TIMEOUT_SECONDS = 30
SETTLE_SECONDS = 0.3


def read_chunk(fd):
    if not select.select([fd], [], [], 0.1)[0]:
        return None
    try:
        return os.read(fd, 4096)
    except OSError:
        return b''


def read_until(fd, marker, deadline):
    seen = b''
    while marker not in seen and time.time() < deadline:
        chunk = read_chunk(fd)
        if chunk == b'':
            return False
        seen += chunk or b''
    return marker in seen


def drain(fd, deadline):
    while time.time() < deadline and read_chunk(fd) != b'':
        pass


def wait_for_exit(pid, deadline):
    while time.time() < deadline:
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished:
            return os.waitstatus_to_exitcode(status)
        time.sleep(0.05)
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    return 125


def main():
    marker = sys.argv[1].encode()
    command = sys.argv[2:]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)

    deadline = time.time() + TIMEOUT_SECONDS
    if not read_until(fd, marker, deadline):
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        print(124)
        return

    time.sleep(SETTLE_SECONDS)
    os.write(fd, b'\x03')
    drain(fd, deadline)
    print(wait_for_exit(pid, deadline))


main()
