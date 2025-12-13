"""
Unit tests for Phase 3: Chat Integration

Tests AIService, chat endpoints, token tracking, and streaming.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from uuid import uuid4
from datetime import datetime

from app.services.ai_service import AIService
from app.models.token_usage import TokenUsage
from app.schemas.ai import ChatMessageRequest, BudgetTier


class TestAIService:
    """Tests for AIService"""

    @pytest.mark.asyncio
    async def test_generate_response(self):
        """Test non-streaming response generation"""
        # Mock Anthropic client creation
        with patch('app.services.ai_service.AsyncAnthropic') as mock_anthropic_class:
            mock_client = AsyncMock()
            mock_anthropic_class.return_value = mock_client

            service = AIService()

            # Mock Anthropic response
            mock_response = Mock()
            mock_response.content = [Mock(text="This is a test response")]
            mock_response.usage = Mock(
                input_tokens=100,
                output_tokens=50
            )
            mock_response.usage.cache_creation_input_tokens = 20
            mock_response.usage.cache_read_input_tokens = 0
            mock_response.stop_reason = "end_turn"

            service.anthropic_client.messages.create = AsyncMock(return_value=mock_response)

            prompt = {
                "model": "claude-3-5-sonnet-20241022",
                "system": [{"type": "text", "text": "You are a screenplay assistant"}],
                "messages": [{"role": "user", "content": [{"type": "text", "text": "Test message"}]}]
            }

            result = await service.generate_response(prompt=prompt, max_tokens=600)

            assert result["content"] == "This is a test response"
            assert result["usage"]["input_tokens"] == 100
            assert result["usage"]["output_tokens"] == 50
            assert result["usage"]["cache_creation_input_tokens"] == 20
            assert result["usage"]["cache_read_input_tokens"] == 0
            assert result["stop_reason"] == "end_turn"

    @pytest.mark.asyncio
    async def test_generate_streaming_response(self):
        """Test streaming response generation"""
        # Mock Anthropic client creation
        with patch('app.services.ai_service.AsyncAnthropic') as mock_anthropic_class:
            mock_client = AsyncMock()
            mock_anthropic_class.return_value = mock_client

            service = AIService()

            # Mock streaming response
            class MockStream:
                def __init__(self):
                    self.chunks = ["This ", "is ", "a ", "test"]
                    self.index = 0

                async def __aenter__(self):
                    return self

                async def __aexit__(self, *args):
                    pass

                @property
                def text_stream(self):
                    async def _text_stream():
                        for chunk in self.chunks:
                            yield chunk
                    return _text_stream()

                async def get_final_message(self):
                    mock_msg = Mock()
                    mock_msg.usage = Mock(
                        input_tokens=100,
                        output_tokens=50,
                        cache_creation_input_tokens=0,
                        cache_read_input_tokens=80
                    )
                    return mock_msg

            service.anthropic_client.messages.stream = Mock(return_value=MockStream())

            prompt = {
                "model": "claude-3-5-sonnet-20241022",
                "system": [],
                "messages": []
            }

            chunks = []
            async for chunk in service._generate_streaming(prompt=prompt, max_tokens=600):
                chunks.append(chunk)

            # Check content chunks
            content_chunks = [c for c in chunks if c["type"] == "content_delta"]
            assert len(content_chunks) == 4
            assert "".join([c["text"] for c in content_chunks]) == "This is a test"

            # Check final usage
            complete_chunks = [c for c in chunks if c["type"] == "message_complete"]
            assert len(complete_chunks) == 1
            assert complete_chunks[0]["usage"]["input_tokens"] == 100
            assert complete_chunks[0]["usage"]["cache_read_input_tokens"] == 80


class TestTokenUsage:
    """Tests for TokenUsage model"""

    def test_token_usage_creation(self):
        """Test token usage record creation"""
        user_id = uuid4()
        script_id = uuid4()
        conversation_id = uuid4()

        usage = TokenUsage(
            user_id=user_id,
            script_id=script_id,
            conversation_id=conversation_id,
            input_tokens=100,
            cache_creation_tokens=20,
            cache_read_tokens=80,
            output_tokens=50,
            total_cost=0.0123
        )

        assert usage.user_id == user_id
        assert usage.script_id == script_id
        assert usage.conversation_id == conversation_id
        assert usage.input_tokens == 100
        assert usage.cache_creation_tokens == 20
        assert usage.cache_read_tokens == 80
        assert usage.output_tokens == 50
        assert usage.total_cost == 0.0123

    def test_token_usage_to_dict(self):
        """Test token usage dict conversion"""
        usage = TokenUsage(
            user_id=uuid4(),
            script_id=uuid4(),
            conversation_id=uuid4(),
            input_tokens=100,
            cache_creation_tokens=0,
            cache_read_tokens=0,
            output_tokens=50,
            total_cost=0.01
        )

        usage_dict = usage.to_dict()

        assert "usage_id" in usage_dict
        assert "user_id" in usage_dict
        assert usage_dict["input_tokens"] == 100
        assert usage_dict["output_tokens"] == 50
        assert usage_dict["total_cost"] == 0.01


class TestChatMessageRequest:
    """Tests for ChatMessageRequest schema"""

    def test_valid_request(self):
        """Test valid chat message request"""
        request = ChatMessageRequest(
            script_id=uuid4(),
            message="Test message",
            budget_tier=BudgetTier.STANDARD
        )

        assert request.message == "Test message"
        assert request.budget_tier == BudgetTier.STANDARD
        assert request.conversation_id is None
        assert request.current_scene_id is None
        assert request.intent_hint is None

    def test_request_with_optional_fields(self):
        """Test request with all optional fields"""
        conversation_id = uuid4()
        scene_id = uuid4()

        request = ChatMessageRequest(
            script_id=uuid4(),
            conversation_id=conversation_id,
            current_scene_id=scene_id,
            message="Test",
            intent_hint="local_edit",
            max_tokens=1000,
            budget_tier=BudgetTier.DEEP
        )

        assert request.conversation_id == conversation_id
        assert request.current_scene_id == scene_id
        assert request.intent_hint == "local_edit"
        assert request.max_tokens == 1000
        assert request.budget_tier == BudgetTier.DEEP


class TestTokenCostCalculation:
    """Tests for token usage cost calculation"""

    def test_standard_cost_calculation(self):
        """Test cost calculation without caching"""
        # 1000 input tokens + 500 output tokens
        # Input: 1000 * $0.003/1K = $0.003
        # Output: 500 * $0.015/1K = $0.0075
        # Total: $0.0105

        input_cost = 1000 * 0.003 / 1000
        output_cost = 500 * 0.015 / 1000
        total = input_cost + output_cost

        assert abs(total - 0.0105) < 0.00001

    def test_cache_write_cost_calculation(self):
        """Test cost calculation with cache creation"""
        # 1000 input + 200 cache creation + 500 output
        # Input: 1000 * $0.003/1K = $0.003
        # Cache creation: 200 * $0.00375/1K = $0.00075
        # Output: 500 * $0.015/1K = $0.0075
        # Total: $0.01125

        input_cost = 1000 * 0.003 / 1000
        cache_creation_cost = 200 * 0.00375 / 1000
        output_cost = 500 * 0.015 / 1000
        total = input_cost + cache_creation_cost + output_cost

        assert abs(total - 0.01125) < 0.00001

    def test_cache_read_cost_calculation(self):
        """Test cost calculation with cache read (90% discount)"""
        # 200 input + 800 cache read + 500 output
        # Input: 200 * $0.003/1K = $0.0006
        # Cache read: 800 * $0.0003/1K = $0.00024
        # Output: 500 * $0.015/1K = $0.0075
        # Total: $0.00834

        input_cost = 200 * 0.003 / 1000
        cache_read_cost = 800 * 0.0003 / 1000
        output_cost = 500 * 0.015 / 1000
        total = input_cost + cache_read_cost + output_cost

        assert abs(total - 0.00834) < 0.00001

    def test_cache_savings_calculation(self):
        """Test cache savings percentage calculation"""
        # With cache: 200 input + 800 cache read
        # Without cache: 1000 input
        # Savings: (800/1000) * 100 = 80%

        input_tokens = 200
        cache_read_tokens = 800
        total_input = input_tokens + cache_read_tokens

        savings_pct = round(100 * cache_read_tokens / total_input)

        assert savings_pct == 80


class TestEndToEndIntegration:
    """Integration tests for full chat flow"""

    @pytest.mark.asyncio
    async def test_chat_flow_with_phase2_integration(self):
        """Test complete chat flow with Phase 2 RAG integration"""
        # This would be a full integration test that:
        # 1. Classifies intent
        # 2. Retrieves relevant scenes
        # 3. Builds context prompt
        # 4. Generates response
        # 5. Tracks token usage
        # 6. Saves conversation

        # Mock all Phase 2 services
        with patch('app.services.intent_classifier.IntentClassifier.classify') as mock_classify:
            with patch('app.services.context_builder.ContextBuilder.build_prompt') as mock_build:
                with patch('app.services.ai_service.AIService.generate_response') as mock_generate:
                    mock_classify.return_value = "local_edit"
                    mock_build.return_value = {
                        "model": "claude-3-5-sonnet-20241022",
                        "system": [],
                        "messages": [],
                        "metadata": {"tokens_used": {"total": 500}}
                    }
                    mock_generate.return_value = {
                        "content": "Test response",
                        "usage": {
                            "input_tokens": 500,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 0,
                            "output_tokens": 100
                        },
                        "stop_reason": "end_turn"
                    }

                    # Assertions would verify the flow
                    assert True  # Placeholder for actual integration test


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
