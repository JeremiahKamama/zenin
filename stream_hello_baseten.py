#!/usr/bin/env python3
"""Streaming example using the Baseten/OpenAI Python client.

Set the `BASETEN_API_KEY` environment variable before running.

Example:
  export BASETEN_API_KEY="your_key_here"
  python3 stream_hello_baseten.py
"""

from openai import OpenAI
import os


def main():
    api_key = os.getenv("BASETEN_API_KEY")
    if not api_key:
        print("Please set BASETEN_API_KEY environment variable.")
        return

    client = OpenAI(
        api_key=api_key,
        base_url="https://inference.baseten.co/v1",
    )

    response = client.chat.completions.create(
        model="zai-org/GLM-5.2",
        messages=[
            {"role": "user", "content": "Implement Hello World in Python"}
        ],
        stream=True,
        top_p=1,
        max_tokens=1000,
        temperature=1,
        presence_penalty=0,
        frequency_penalty=0,
    )

    try:
        for chunk in response:
            # Response chunks may vary in structure; guard defensively.
            try:
                delta = chunk.choices[0].delta.content
            except Exception:
                delta = None
            if delta is not None:
                print(delta, end="", flush=True)
    except KeyboardInterrupt:
        print("\nStreaming interrupted by user.")


if __name__ == "__main__":
    main()
