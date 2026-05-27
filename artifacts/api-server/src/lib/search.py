#!/usr/bin/env python3
import sys
import json
from ddgs import DDGS

def main():
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    query = sys.argv[1]
    results = []

    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=5):
                results.append({
                    "title": r.get("title", ""),
                    "body": r.get("body", ""),
                    "href": r.get("href", ""),
                })
    except Exception as e:
        sys.stderr.write(str(e) + "\n")

    print(json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
